// A minimal XLSX (Office Open XML spreadsheet) writer: text, numbers, dates,
// percentages, a few cell styles and native bar/column charts. Enough for the
// poll report without pulling in a large spreadsheet library.
//
// writeXlsx([{ name, cols: [width...], rows: [[cell...]], charts: [chart...] }])
//   cell:  null | string | number | { v, style }  (style: 'bold' | 'title' |
//          'header' | 'date' | 'percent'; dates are Excel serial numbers)
//   chart: { title, dir: 'bar' | 'col', dateFormat?, cats: range, vals: range,
//            at: { col, row, cols, rows } }   (0-based cells)
//   range: { col, from, to }  (0-based column and rows, on the same sheet)
// Returns a Buffer.
const zlib = require('zlib');

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const NS_CHART = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_XDR = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
const TYPE = 'application/vnd.openxmlformats-officedocument';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const CHART_COLOR = '7E22CE';
const STYLE_IDS = { bold: 1, title: 2, header: 3, date: 4, percent: 5 };

// Escapes text for XML and drops the control characters XML 1.0 forbids
// (poll text is user input and could contain them).
function esc(value) {
    return String(value)
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 0 → A, 25 → Z, 26 → AA
function colName(index) {
    let name = '';
    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
    return name;
}

// An absolute reference like 'Sonuçlar'!$A$2:$A$5.
function rangeRef(sheetName, { col, from, to }) {
    const c = colName(col);
    return `'${sheetName.replace(/'/g, "''")}'!$${c}$${from + 1}:$${c}$${to + 1}`;
}

function cellXml(cell, ref) {
    if (cell === null || cell === undefined) return '';
    const { v, style } = typeof cell === 'object' ? cell : { v: cell };
    if (v === null || v === undefined) return '';
    const s = style ? ` s="${STYLE_IDS[style]}"` : '';
    if (typeof v === 'number') return Number.isFinite(v) ? `<c r="${ref}"${s}><v>${v}</v></c>` : '';
    return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
}

function sheetXml(sheet, hasDrawing) {
    const cols = (sheet.cols || []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
    const rows = sheet.rows.map((row, r) => {
        const cells = row.map((cell, c) => cellXml(cell, colName(c) + (r + 1))).join('');
        return `<row r="${r + 1}">${cells}</row>`;
    }).join('');
    return XML_HEAD + `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">`
        + (cols ? `<cols>${cols}</cols>` : '')
        + `<sheetData>${rows}</sheetData>`
        + (hasDrawing ? '<drawing r:id="rId1"/>' : '')
        + '</worksheet>';
}

function cellValue(cell) {
    return cell !== null && typeof cell === 'object' ? cell.v : cell;
}

// Charts carry a cached copy of their data, which is what most readers show
// until the workbook is recalculated.
function chartXml(sheet, chart) {
    const catValues = [];
    const valValues = [];
    for (let r = chart.cats.from; r <= chart.cats.to; r++) catValues.push(cellValue(sheet.rows[r]?.[chart.cats.col]));
    for (let r = chart.vals.from; r <= chart.vals.to; r++) valValues.push(cellValue(sheet.rows[r]?.[chart.vals.col]));
    const pts = (values) => values.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v ?? '')}</c:v></c:pt>`).join('');
    const catRef = rangeRef(sheet.name, chart.cats);
    const cat = chart.dateFormat
        ? `<c:numRef><c:f>${esc(catRef)}</c:f><c:numCache><c:formatCode>${esc(chart.dateFormat)}</c:formatCode>`
            + `<c:ptCount val="${catValues.length}"/>${pts(catValues)}</c:numCache></c:numRef>`
        : `<c:strRef><c:f>${esc(catRef)}</c:f><c:strCache><c:ptCount val="${catValues.length}"/>${pts(catValues)}</c:strCache></c:strRef>`;
    const val = `<c:numRef><c:f>${esc(rangeRef(sheet.name, chart.vals))}</c:f><c:numCache><c:formatCode>General</c:formatCode>`
        + `<c:ptCount val="${valValues.length}"/>${pts(valValues)}</c:numCache></c:numRef>`;
    const horizontal = chart.dir === 'bar';
    const noLabels = '<c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/>'
        + '<c:showPercent val="0"/><c:showBubbleSize val="0"/>';
    const grayLine = '<c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill></a:ln></c:spPr>';
    return XML_HEAD + `<c:chartSpace xmlns:c="${NS_CHART}" xmlns:a="${NS_A}" xmlns:r="${NS_REL}">`
        + '<c:roundedCorners val="0"/><c:chart>'
        + `<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:pPr><a:defRPr sz="1200" b="1"/></a:pPr><a:r><a:rPr lang="tr-TR" sz="1200" b="1"/><a:t>${esc(chart.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`
        + '<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>'
        + `<c:barChart><c:barDir val="${horizontal ? 'bar' : 'col'}"/><c:grouping val="clustered"/><c:varyColors val="0"/>`
        + `<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>${esc(chart.series || 'Oy')}</c:v></c:tx>`
        + `<c:spPr><a:solidFill><a:srgbClr val="${CHART_COLOR}"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/>`
        // Value at the tip of each bar (the chart's only series needs no legend).
        + (chart.labels
            ? '<c:dLbls><c:dLblPos val="outEnd"/><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/>'
                + '<c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>'
            : `<c:dLbls>${noLabels}</c:dLbls>`)
        + `<c:cat>${cat}</c:cat><c:val>${val}</c:val></c:ser>`
        + `<c:gapWidth val="${horizontal ? 80 : 30}"/><c:axId val="1"/><c:axId val="2"/></c:barChart>`
        // Horizontal bars: first option on top, as in the table.
        + `<c:catAx><c:axId val="1"/><c:scaling><c:orientation val="${horizontal ? 'maxMin' : 'minMax'}"/></c:scaling>`
        + `<c:delete val="0"/><c:axPos val="${horizontal ? 'l' : 'b'}"/>`
        + `<c:numFmt formatCode="${esc(chart.dateFormat || 'General')}" sourceLinked="0"/>`
        + `<c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${grayLine}`
        + '<c:crossAx val="2"/><c:crosses val="autoZero"/><c:auto val="0"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>'
        + `<c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/><c:min val="0"/></c:scaling><c:delete val="0"/>`
        + `<c:axPos val="${horizontal ? 'b' : 'l'}"/><c:majorGridlines>${grayLine}</c:majorGridlines>`
        + '<c:numFmt formatCode="0" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>'
        + `<c:spPr><a:ln><a:noFill/></a:ln></c:spPr><c:crossAx val="1"/><c:crosses val="${horizontal ? 'max' : 'autoZero'}"/><c:crossBetween val="between"/></c:valAx>`
        + '</c:plotArea><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>';
}

function drawingXml(charts, firstRelId) {
    const anchors = charts.map((chart, i) => {
        const { col, row, cols, rows } = chart.at;
        const point = (tag, c, r) => `<xdr:${tag}><xdr:col>${c}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:${tag}>`;
        return '<xdr:twoCellAnchor>' + point('from', col, row) + point('to', col + cols, row + rows)
            + `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="${esc(chart.title)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>`
            + '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>'
            + `<a:graphic><a:graphicData uri="${NS_CHART}"><c:chart xmlns:c="${NS_CHART}" xmlns:r="${NS_REL}" r:id="rId${firstRelId + i}"/></a:graphicData></a:graphic>`
            + '</xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>';
    }).join('');
    return XML_HEAD + `<xdr:wsDr xmlns:xdr="${NS_XDR}" xmlns:a="${NS_A}">${anchors}</xdr:wsDr>`;
}

function rels(list) {
    return XML_HEAD + `<Relationships xmlns="${NS_PKG_REL}">`
        + list.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`).join('')
        + '</Relationships>';
}

const STYLES = XML_HEAD + `<styleSheet xmlns="${NS_MAIN}">`
    + '<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm:ss"/></numFmts>'
    + '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font>'
    + '<font><b/><sz val="15"/><name val="Calibri"/></font></fonts>'
    + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FFEDE8FF"/><bgColor indexed="64"/></patternFill></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="6">'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
    + '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
    + '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'
    + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left"/></xf>'
    + '<xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left"/></xf>'
    + '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

function writeXlsx(sheets) {
    const files = [];
    const overrides = [
        ['/xl/workbook.xml', `${TYPE}.spreadsheetml.sheet.main+xml`],
        ['/xl/styles.xml', `${TYPE}.spreadsheetml.styles+xml`]
    ];
    let chartNo = 0;
    sheets.forEach((sheet, i) => {
        const n = i + 1;
        const charts = sheet.charts || [];
        files.push([`xl/worksheets/sheet${n}.xml`, sheetXml(sheet, charts.length > 0)]);
        overrides.push([`/xl/worksheets/sheet${n}.xml`, `${TYPE}.spreadsheetml.worksheet+xml`]);
        if (!charts.length) return;
        files.push([`xl/worksheets/_rels/sheet${n}.xml.rels`, rels([['rId1', `${NS_REL}/drawing`, `../drawings/drawing${n}.xml`]])]);
        files.push([`xl/drawings/drawing${n}.xml`, drawingXml(charts, 1)]);
        overrides.push([`/xl/drawings/drawing${n}.xml`, `${TYPE}.drawing+xml`]);
        const chartRels = charts.map((chart, k) => {
            chartNo++;
            files.push([`xl/charts/chart${chartNo}.xml`, chartXml(sheet, chart)]);
            overrides.push([`/xl/charts/chart${chartNo}.xml`, `${TYPE}.drawingml.chart+xml`]);
            return [`rId${k + 1}`, `${NS_REL}/chart`, `../charts/chart${chartNo}.xml`];
        });
        files.push([`xl/drawings/_rels/drawing${n}.xml.rels`, rels(chartRels)]);
    });
    files.push(['xl/workbook.xml', XML_HEAD + `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheets>`
        + sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
        + '</sheets></workbook>']);
    files.push(['xl/_rels/workbook.xml.rels', rels([
        ...sheets.map((s, i) => [`rId${i + 1}`, `${NS_REL}/worksheet`, `worksheets/sheet${i + 1}.xml`]),
        [`rId${sheets.length + 1}`, `${NS_REL}/styles`, 'styles.xml']
    ])]);
    files.push(['xl/styles.xml', STYLES]);
    files.push(['_rels/.rels', rels([['rId1', `${NS_REL}/officeDocument`, 'xl/workbook.xml']])]);
    files.unshift(['[Content_Types].xml', XML_HEAD
        + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + overrides.map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`).join('')
        + '</Types>']);
    return zip(files.map(([name, text]) => [name, Buffer.from(text, 'utf8')]));
}

// A ZIP archive of deflated entries (all an XLSX file is on the outside).
function zip(entries) {
    const local = [];
    const central = [];
    let offset = 0;
    // DOS date/time fields; a fixed 1980-01-01 keeps output reproducible.
    const dosTime = 0;
    const dosDate = (0 << 9) | (1 << 5) | 1;
    for (const [name, data] of entries) {
        const nameBuf = Buffer.from(name, 'utf8');
        const packed = zlib.deflateRawSync(data);
        const crc = zlib.crc32(data);
        const header = Buffer.alloc(30);
        header.writeUInt32LE(0x04034b50, 0);
        header.writeUInt16LE(20, 4);        // version needed
        header.writeUInt16LE(0x0800, 6);    // UTF-8 names
        header.writeUInt16LE(8, 8);         // deflate
        header.writeUInt16LE(dosTime, 10);
        header.writeUInt16LE(dosDate, 12);
        header.writeUInt32LE(crc, 14);
        header.writeUInt32LE(packed.length, 18);
        header.writeUInt32LE(data.length, 22);
        header.writeUInt16LE(nameBuf.length, 26);
        header.writeUInt16LE(0, 28);
        local.push(header, nameBuf, packed);

        const dir = Buffer.alloc(46);
        dir.writeUInt32LE(0x02014b50, 0);
        dir.writeUInt16LE(20, 4);           // version made by
        dir.writeUInt16LE(20, 6);
        dir.writeUInt16LE(0x0800, 8);
        dir.writeUInt16LE(8, 10);
        dir.writeUInt16LE(dosTime, 12);
        dir.writeUInt16LE(dosDate, 14);
        dir.writeUInt32LE(crc, 16);
        dir.writeUInt32LE(packed.length, 20);
        dir.writeUInt32LE(data.length, 24);
        dir.writeUInt16LE(nameBuf.length, 28);
        dir.writeUInt32LE(offset, 42);      // other fields stay 0
        central.push(dir, nameBuf);
        offset += header.length + nameBuf.length + packed.length;
    }
    const centralBuf = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralBuf.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...local, centralBuf, end]);
}

module.exports = { writeXlsx };
