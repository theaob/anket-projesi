# Changelog

Bu proje [Keep a Changelog](https://keepachangelog.com/tr/1.0.0/) formatını,
ve [Semantic Versioning](https://semver.org/lang/tr/) kurallarını kullanır.

## [Unreleased]

### Güvenlik
- **CSV formül enjeksiyonu**: Dışa aktarılan dosyada `=`, `+`, `-` veya `@` ile başlayan seçenek metinleri artık başına `'` eklenerek yazılıyor; Excel bunları formül olarak çalıştırmıyor.
- **Docker imajı yetkisiz kullanıcıyla çalışıyor**: Sunucu artık `root` yerine `node` kullanıcısıyla çalışıyor. v2.0.0 ile oluşturulmuş veri volume'lerinin sahipliği açılışta otomatik olarak düzeltiliyor.

### Eklendi
- **Erişilebilirlik**: Tüm sayfalar axe-core denetiminde WCAG 2 A/AA ihlali vermiyor. Metin ve düğme renkleri 4.5:1 kontrasta (başlık gradyanı büyük yazı için 3:1'e) getirildi; tüm denetimlerde klavye odak halkası var; bağlantı alanlarının etiketleri, sayfa başlıkları ve `<main>` bölgeleri eklendi. Oy ekranında sonuç düğmeleri ekran okuyucuya "Evet: %60, 3 oy" gibi okunuyor, oy kaydı ve oylamanın kapanması duyuruluyor (geri sayım her saniye okunmuyor), ankete katılınca odak soruya geçiyor; dekoratif emoji efektleri ekran okuyucudan gizlendi.
- **ESLint**: `npm run lint`; CI'da testlerle birlikte çalışıyor.
- **Güvenli sürüm betiği**: `npm run release:*` artık yalnızca `main` dalında, temiz ve GitHub ile eşit bir çalışma kopyasında ve CHANGELOG'da yeni sürümün bölümü varken sürüm çıkarıyor; `-- --dry-run` ile yalnızca kontrol eder.
- **Otomatik testler ve CI**: Sunucu için entegrasyon testleri (`npm test`; kimlik doğrulama, tek oy, oylama aç/kapat, CSV, dayanıklılık, kalıcılık, hız sınırları). GitHub Actions'ta her push ve pull request'te testler çalışıyor ve Docker imajı derlenip duman testinden geçiriliyor.
- **`/healthz` ve Docker `HEALTHCHECK`**.
- **`PORT` ortam değişkeni** (varsayılan `3000`).

### Değiştirildi
- **Daha akıcı animasyonlar**: Sonuç çubukları her canlı güncellemede sıfırdan yeniden çizilmek yerine (oy ekranında her oyda %0'a düşüp yeniden büyüyordu) eski değerden yenisine kayarak ilerliyor; yüzdeler, oy sayıları ve istatistikler yeni değere sayarak ulaşıyor (oy ekranı, yönetim sayfası ve sunum ekranı). Yönetim sayfasındaki çubuklar artık hedefi aşıp geri dönmüyor; sunum ekranında öndeki seçeneğin rengi yumuşak geçişle değişiyor.
- **Okunabilir başlık animasyonu**: "Ankete Katıl" harfleri sürekli dönmek yerine hafifçe dalgalanıyor ve birkaç saniyede bir harfler sırayla dönüyor; başlık zamanın büyük kısmında (önceden hiç) tam okunabiliyor.
- Kod girişinden ankete geçiş (ve anket silinince geri dönüş) destekleyen tarayıcılarda yumuşak geçişle yapılıyor.
- İşletim sistemindeki "hareketi azalt" ayarı tüm sayfalarda tüm efektler için uygulanıyor (oy kutlaması, çubuk geçişleri, sayı animasyonları, hane kutuları, arka plan).
- Ana sayfadaki başlık animasyonu yalnızca görünürken çalışıyor: bir ankete katılınca veya başlık ekrandan kaydırılınca duruyor (telefonlarda pil tasarrufu).
- README güncellendi: yeni başlık ve açıklama (kapalı ağ ve internet kullanımı), CI rozeti, sürüm çıkarma adımları.
- `package.json`: paket adı `anket-projesi` oldu ve `"private": true` eklendi.
- **Canlı güncellemeler toplu gönderiliyor**: Her oyda tüm katılımcılara, yöneticilere ve sunum ekranlarına ayrı ayrı mesaj gitmesi yerine güncellemeler anket başına en fazla 250 ms'de bir, en son durumu taşıyarak gönderiliyor. İlk değişiklik anında gider, hiçbir güncelleme kaybolmaz. Kalabalık salonlarda sunucu ve ağ yükü büyük ölçüde azalıyor.
- **"Oy vermeden ayrılan" sayısı kısa kopmaları saymıyor**: Ziyaretçi ancak 10 saniye geri dönmezse ayrılmış sayılıyor; sayfa yenileme veya kısa bağlantı kopması sayıyı artırmıyor. Süre dolduğunda yönetim sayfası kendiliğinden güncelleniyor.
- Docker derlemesi `package-lock.json` ile `npm ci` kullanıyor; bağımlılık sürümleri artık sabit.
- GitHub Actions: tüm eylemler Node 24 kullanan sürümlere yükseltildi (`actions/checkout` v5, `actions/setup-node` v5, `docker/setup-buildx-action` v4, `docker/login-action` v4, `docker/build-push-action` v7, `softprops/action-gh-release` v3); yayın iş akışında yalnızca sürüm oluşturan iş yazma yetkisine sahip. CI, Docker imajını yayın iş akışıyla aynı eylemlerle derliyor.

## [2.0.0] - 2026-09-23

### ⚠️ Yükseltme notları
- **Mevcut anketler silinir.** Ortak admin paneli kaldırıldığı için sahibi olmayan tüm anketler ve sonuçları ilk açılışta veritabanından kalıcı olarak silinir. Saklamak istediğiniz sonuçları yükseltmeden önce dışa aktarın.
- **Node.js 22.13+ gerekir** (Docker imajı `node:22-alpine` kullanıyor).
- **Veri artık kalıcı:** Docker'da `/app/data` dizinine bir volume bağlayın (`-v anket-data:/app/data`) ve `--restart unless-stopped` kullanın.
- **İnternette yayınlıyorsanız** HTTPS ters vekil arkasında çalıştırın ve `TRUST_PROXY=1`, `PUBLIC_URL=https://alan-adiniz` ayarlayın; Cloudflare Turnstile önerilir (`TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`). Ayrıntılar README'de "İnternette Yayınlama" bölümünde.
- `/admin.html` ve `/export` adresleri kaldırıldı.

### Güvenlik
- **Toplu oy kullanmaya karşı koruma (internette yayın için)**: Katılımcı kimliği artık tarayıcıda üretilmiyor; sunucu her tarayıcıya imzalı, HttpOnly bir çerez veriyor (`/api/voter`) ve oy yalnızca geçerli çerezle kabul ediliyor. Yeni kimlikler ağ başına (IP; IPv6'da /64) sınırlı hızda veriliyor (`VOTER_ID_BURST`, `VOTER_ID_PER_HOUR`); sınıra takılan ziyaretçi bekleyip otomatik katılıyor. İsteğe bağlı Cloudflare Turnstile doğrulaması eklendi (`TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`). Önceden bir betik uydurma kimliklerle saniyede yüzlerce oy kullanabiliyordu.
- **Ters vekil desteği**: `TRUST_PROXY` ile gerçek istemci adresi `X-Forwarded-For` başlığından alınıyor (hız sınırları için); ayarlanmadan bu başlık gelirse günlüğe uyarı yazılıyor. Anket oluşturma sınırı da gerçek istemci adresine göre uygulanıyor. Katılım bağlantıları ve QR kodu HTTPS vekil arkasında `https://` kullanıyor; çerezler HTTPS'te `Secure` olarak işaretleniyor.

### Düzeltildi
- **Sunucu çökmelerine karşı koruma**: Tüm soket olayları hata yakalayıcıyla sarıldı; hatalı bir mesaj ya da veritabanı hatası artık sunucuyu çökertmiyor, hata günlüğe yazılıyor ve istemciye hata yanıtı dönülüyor. Veritabanı yazması başarısız olursa bellekteki durum değişmiyor. Mesaj boyutu 64 KB ile sınırlandı. Beklenmeyen bir hatada sunucu veritabanını düzgünce kapatıp çıkıyor (Docker `--restart` ile yeniden başlar).
- **İçerik Güvenlik Politikası (CSP)**: Sayfalardaki satır içi betikler `public/js/` altındaki dosyalara taşındı ve sunucu yalnızca kendi betik dosyalarının çalışmasına izin veren bir `Content-Security-Policy` başlığı gönderiyor; `X-Content-Type-Options` ve `Referrer-Policy` başlıkları da eklendi.
- **Anket kodlarının tükenmesi**: 4 haneli kodlar (9000 adet) neredeyse dolduğunda sunucu otomatik olarak 5 haneli kodlar vermeye başlıyor; katılım ekranı 5. haneyi yalnızca gerektiğinde gösteriyor.
- **Seçenek metinleriyle kod enjeksiyonu (XSS)**: Oy ekranı seçenek metinlerini artık HTML olarak değil düz metin olarak gösteriyor; anket oluşturan biri katılımcıların tarayıcısında kod çalıştıramıyor.
- **Sunucu tarafında oy sınırı**: Her tarayıcı rastgele bir kimlikle bağlanıyor ve sunucu, aynı kimliğin bir ankette ikinci kez oy vermesini reddediyor. Oy vermek için önce ankete katılmış olmak gerekiyor ve geçersiz seçenek indeksleri reddediliyor. Önceden sınır yalnızca tarayıcıdaki `localStorage` bayrağıydı.
- **Kaydet oyları silmiyor**: Anketi kaydetmek artık yalnızca seçenekler değiştiyse oyları sıfırlıyor (ve admin panelinde önce onay isteniyor). Soru metnindeki bir düzeltme oyları korur.
- **Bağlantı kopunca otomatik yeniden katılma**: Oy ekranı ve admin paneli yeniden bağlandığında ankete/admin odasına tekrar katılıyor; bağlantı koptuğunda bir uyarı gösteriliyor.
- **Sıfırlama sonrası tekrar oy verme**: Oylar sıfırlandığında veya seçenekler değiştiğinde daha önce oy verenler yeniden oy verebiliyor (önceden eski `localStorage` bayrağı yüzünden kilitli kalıyorlardı).
- **Boş GitHub Release notları**: Yayın iş akışı CHANGELOG bölümünü `v` önekiyle aradığı için hiçbir zaman bulamıyordu; artık doğru bölüm çıkarılıyor.

### Eklendi
- **Oylamayı aç/kapat ve zamanlayıcı**: Yönetim sayfasından oylama elle kapatılıp açılabiliyor ya da süreli başlatılabiliyor (30 sn, 1/2/5 dk, "+30 sn" ile uzatma, süreyi kaldırma). Süre dolunca oylama sunucu tarafından otomatik kapanıyor ve kapalı ankette oy kabul edilmiyor. Oylama kapandığında sonuçlar tüm katılımcılara gösteriliyor. Oy ekranında, yönetim sayfasında ve sunum ekranında geri sayım var (son 10 saniyede kırmızı); sunum ekranında gizlenen sonuçlar kapanışta otomatik açılıyor. Geri sayım kalan süreye göre yapıldığı için cihaz saatlerinin yanlış olması etkilemiyor. Durum veritabanında saklanıyor: çalışan zamanlayıcı yeniden başlatmadan sonra devam ediyor, kapalıyken süresi dolan anket açılışta kapanıyor.
- **Sunum ekranı**: Projeksiyon için tam ekran canlı sonuç sayfası (`/present?code=…`, yönetim sayfasından "Sunum ekranını aç"). Soru, canlı çubuklar, önde olan seçenek, toplam oy ve bağlı katılımcı sayısı ile katılım QR kodu, adresi ve anket kodu gösteriliyor. Klavye kısayolları: F tam ekran, H sonuçları gizle/göster. Seçenekler ekrana sığacak şekilde otomatik küçülüyor, gerekirse iki sütuna bölünüyor. Ekran ziyaret olarak sayılmıyor ve yönetim anahtarı içermiyor. QR kodu sunucuda (`qrcode` paketi) üretildiği için internet gerektirmiyor; `localhost` üzerinden açıldığında ağ IP adresi kullanılıyor, `PUBLIC_URL` ile adres belirlenebiliyor.
- **Herkes kendi anketini yönetir**: Ortak admin paneli kaldırıldı. Ana sayfadaki "Yeni anket oluştur" düğmesiyle herkes anket oluşturabiliyor ve anketi yalnızca oluşturana verilen gizli yönetim bağlantısıyla (`/manage#…`) düzenlenebiliyor, sıfırlanabiliyor, dışa aktarılabiliyor veya silinebiliyor. Sunucu anahtarın yalnızca SHA-256 özetini saklıyor. Tarayıcı, oluşturduğu anketlerin bağlantılarını hatırlıyor ve ana sayfada listeliyor. Kötüye kullanımı önlemek için adres başına saatte 20 anket sınırı var.
- **SQLite veritabanı**: Anketler, seçenekler, ziyaretçiler ve oylar `data/anket.db` SQLite veritabanında saklanıyor ve sunucu başlarken geri yükleniyor (`DATA_DIR` ile değiştirilebilir). Her oy, zaman damgasıyla ayrı bir satır olarak kaydediliyor; "kişi başı tek oy" kuralı veritabanı tarafından da uygulanıyor. Node.js'in yerleşik `node:sqlite` modülü kullanıldığından ek bağımlılık yok. Docker imajı `/app/data` volume'ü tanımlıyor.

### Kaldırıldı
- `admin.html` ve ortak admin paneli (eski adres ana sayfaya yönlendiriliyor). Yükseltme sırasında, sahibi olmayan mevcut anketler ve sonuçları veritabanından siliniyor.
- `/export` adresi kaldırıldı; CSV dışa aktarımı artık yönetim sayfasından yapılıyor.

### Değiştirildi
- Docker imajı Node.js 18'den (desteği sona erdi) Node.js 22'ye yükseltildi; artık Node.js 22.13+ gerekiyor.
- Docker imajı artık yalnızca `linux/amd64` için yayınlanıyor; `linux/arm64` imajı kaldırıldı (Node.js 22, derleme sırasındaki arm64 emülasyonunda çöküyordu).
- Ziyaret sayısı artık tekil tarayıcı başına sayılıyor; sayfa yenileme veya yeniden bağlanma ziyareti ya da "oy vermeden ayrılan" sayısını şişirmiyor. "Oy vermeden ayrılan", oy vermemiş ve şu anda bağlı olmayan ziyaretçileri gösteriyor.

## [1.4.2] - 2026-08-05

### Kaldırıldı
- `results.html` sayfası kaldırıldı. Daha önce oy verilmiş bir kod tekrar girildiğinde, ayrı bir sayfaya yönlendirmek yerine oylama kartı doğrudan aynı sayfada sonuç görünümüne geçiyor.

## [1.4.1] - 2026-08-05

### Düzeltildi
- Oy verdikten sonra artık `results.html`'e yönlendirilmiyor; oylama kartı sonuçları (dolgu çubukları ve yüzdeler) doğrudan yerinde gösteriyor.

### Değiştirildi
- Canlı sonuçlar sayfası, oylama kartındaki tasarımla eşleşecek şekilde yenilendi: aynı kart + bulanık arka plan ve aynı çubuk/yüzde stiliyle.

## [1.4.0] - 2026-08-04

### Eklendi
- **Yeni Oylama Ekranı Tasarımı**: Katılım ekranı; animasyonlu bulanık arka plan, dört haneli kutu şeklinde kod girişi, akan gradyanlı dalga/çevirme başlık animasyonu ve oy verildiğinde onay işareti + parçacık patlamalı kutlama efektiyle yenilendi. Oy verdikten sonra gerçek zamanlı yüzde gösterimiyle sonuçlara yönlendiriliyor.

## [1.3.1] - 2026-08-04

### Düzeltildi
- Statik dosyalar artık `Cache-Control: no-cache` ile sunuluyor; tarayıcılar her istekte sunucuyla doğrulama yapıyor (ETag/304), böylece yeni bir sürüm elle önbellek temizlemeye gerek kalmadan bir sonraki sayfa yüklemesinde devreye giriyor.

### Değiştirildi
- Giriş ekranındaki "Ankete Katıl" başlığı artık fare girişi olmadan da sürekli dalgalanıyor; fareyi harfe yaklaştırmak dalga genliğini artırıyor (önceden harfleri imlece doğru çekiyordu).
- Uçuşan emoji efektinin ekranda kalma süresi uzatıldı ve oy verme ekranındaki sonuçlara yönlendirme gecikmesi, efektin görülebilmesi için artırıldı.

## [1.3.0] - 2026-08-03

### Eklendi
- **Kullanım Metrikleri**: Anket bazında ziyaret sayısı ve "oy vermeden ayrılan" sayısı takibi; admin panelinde anket listesi ve düzenleyicide canlı gösterim, CSV dışa aktarımında özet satırlar.
- **Oylama ve Sonuç Ekranı Animasyonları**: Oylama ekranında seçeneklerin sırayla belirmesi ve seçim anında geri bildirim animasyonu; sonuç ekranında çubukların artık gerçekten akıcı biçimde büyümesi (önceden CSS geçişi tanımlıydı ama grafik her güncellemede sıfırdan çizildiği için hiç çalışmıyordu).
- **Uçuşan Emoji Efekti**: Bir kullanıcı oy verdiğinde hem oylama ekranında hem de canlı sonuçları izleyenlerin ekranında uçuşan emoji patlaması gösteriliyor.

### Değiştirildi
- Uygulama genelinde koyu temadan açık (light) renk paletine geçildi.

## [1.2.0] - 2026-08-03

### Kaldırıldı
- **Anket Ağırlıkları**: Seçeneklere ağırlık atama ve "Genel Ortalama" hesaplama özelliği kaldırıldı; seçenekler artık düz metin olarak saklanıyor.

### Düzeltildi
- CSV dışa aktarımında seçenek metni yerine `[object Object]` yazdıran hata giderildi.

### Değiştirildi
- Giriş sayfasındaki başlık animasyonu performans için `requestAnimationFrame` ile optimize edildi.

## [1.1.0] - 2026-03-06

### Eklendi
- **Anket Ağırlıkları**: Anket seçeneklerine rakamsal değerler atama ve "Genel Ortalama" hesaplama özelliği eklendi.
- **GitHub Release Otomasyonu**: Yeni versiyonlarda otomatik GitHub Release oluşturma akışı eklendi.

## [1.0.5] - 2026-03-06

### Eklendi
- Admin panelinde anket seçildiğinde seçeneklerin doldurulması düzeltildi.

## [1.0.4] - 2026-03-03

### Eklendi
- Versiyon değişikliğinde otomatik tagleme workflowu eklendi.
- DockerHub'da versiyon düzeltilmesi için güncelleme yapıldı.

## [1.0.2] - 2026-03-03

### Eklendi
- Github workflow akışı düzeltildi.

## [1.0.1] - 2026-03-03

### Eklendi
- Giriş sayfası animasyonu düzeltildi.
- Sonuç sayfasında dikey/yatay gösterim yeteneği eklendi.

## [1.0.0] - 2026-02-19

### Eklendi
- Çoklu anket desteği — her anket benzersiz 4 haneli rakam koduyla tanımlanır
- Admin paneli: anket listesi + anket düzenleyici iki paneli
- Oy sayfası: kod giriş ekranı, tek oy sınırı (localStorage), oy sonrası otomatik yönlendirme
- Sonuç sayfası: yatay / dikey grafik modu toggle'ı
- Docker imajı yayınlama (GitHub Actions)
