// Bumps the version, tags it and pushes, which triggers the Docker image and
// GitHub release workflows. Usage: npm run release:patch|minor|major
// (add -- --dry-run to only run the checks).
//
// Refuses to run unless it is safe: on main, nothing uncommitted, in sync with
// GitHub, and CHANGELOG.md already has a section for the new version (the
// release notes are taken from it).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

function fail(message) {
    console.error(`✖ ${message}`);
    process.exit(1);
}

function nextVersion(current, type) {
    const [major, minor, patch] = current.split('.').map(Number);
    if (type === 'major') return `${major + 1}.0.0`;
    if (type === 'minor') return `${major}.${minor + 1}.0`;
    if (type === 'patch') return `${major}.${minor}.${patch + 1}`;
    return fail('Usage: npm run release:patch | release:minor | release:major');
}

const type = process.argv[2];
const dryRun = process.argv.includes('--dry-run');
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const next = nextVersion(version, type);

const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
if (branch !== 'main') fail(`Releases can only be made from main (current branch: ${branch}).`);

if (git('status', '--porcelain')) fail('There are uncommitted changes; commit or discard them first.');

git('fetch', '--quiet', 'origin', 'main');
if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main')) {
    fail('Local main differs from origin/main; pull or push first.');
}

const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
if (!changelog.includes(`## [${next}]`)) {
    fail(`CHANGELOG.md has no "## [${next}]" section. Rename "## [Unreleased]" to ` +
        `"## [${next}] - ${new Date().toISOString().slice(0, 10)}" and commit.`);
}

console.log(`✔ Checks passed: ${version} → ${next}`);
if (dryRun) process.exit(0);

execFileSync('npm', ['version', next, '-m', '%s'], { cwd: ROOT, stdio: 'inherit' });
execFileSync('git', ['push', 'origin', 'main', `v${next}`], { cwd: ROOT, stdio: 'inherit' });
console.log(`✔ Pushed v${next}; GitHub Actions will publish the image and release notes.`);
