// CI-only asset collector: never imports application code or accesses local user settings.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
// Both tools are locked dependencies of electron-builder; npm ci installs them.
const yaml = require('js-yaml');
const asar = require('@electron/asar');
const digest = (file, algorithm = 'sha256', encoding = 'hex') => crypto.createHash(algorithm).update(fs.readFileSync(file)).digest(encoding);

export function collectReleaseAssets(root, { commit, env = process.env } = {}) {
  const release = path.join(root, 'release');
  const output = path.join(release, 'checked-release');
  assert.ok(!fs.existsSync(output), 'Refuse to mix fresh output with a previous artifact');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'build-manifest.json'), 'utf8'));
  const verification = JSON.parse(fs.readFileSync(path.join(release, 'packaged-verification.json'), 'utf8'));
  assert.match(pkg.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  assert.match(manifest.buildId, /^[0-9A-Za-z._-]+$/);
  assert.equal(manifest.appVersion, pkg.version);
  assert.equal(verification.buildId, manifest.buildId);
  assert.equal(verification.passed, true);
  assert.match(commit, /^[a-f0-9]{40}$/);
  assert.match(env.GITHUB_RUN_ID || '', /^\d+$/);
  assert.match(env.GITHUB_RUN_ATTEMPT || '', /^\d+$/);
  assert.match(env.GITHUB_REPOSITORY || '', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  const base = `Azat-Studio-${pkg.version}-arm64`;
  const archives = [`${base}.zip`, `${base}.dmg`];
  function regularFile(name) {
    assert.equal(path.basename(name), name, 'Asset paths must be flat filenames');
    const file = path.join(release, name);
    assert.ok(fs.lstatSync(file).isFile(), `Missing regular asset: ${name}`);
    return file;
  }
  for (const name of archives) regularFile(name);
  const feed = yaml.load(fs.readFileSync(regularFile('latest-mac.yml'), 'utf8'));
  assert.equal(feed.version, pkg.version, 'Feed version differs from the checked app');
  assert.ok(Array.isArray(feed.files) && feed.files.length > 0, 'The macOS update feed needs file entries');
  const referenced = new Set();
  for (const entry of feed.files) {
    assert.equal(typeof entry.url, 'string');
    const name = decodeURIComponent(entry.url);
    assert.ok(archives.includes(name), `Unexpected update feed URL: ${name}`);
    const file = regularFile(name);
    assert.equal(entry.sha512, digest(file, 'sha512', 'base64'), `Update checksum differs: ${name}`);
    assert.equal(entry.size, fs.statSync(file).size, `Update size differs: ${name}`);
    referenced.add(name);
  }
  assert.ok(referenced.has(`${base}.zip`), 'The macOS update feed must include the ZIP');
  if (feed.path !== undefined) {
    const legacy = decodeURIComponent(feed.path);
    assert.ok(archives.includes(legacy), 'Unexpected legacy update path');
    assert.equal(feed.sha512, digest(regularFile(legacy), 'sha512', 'base64'));
  }
  const bundle = path.join(release, 'mac-arm64', 'Azat Studio.app');
  const environmentFile = name => name.split(/[\\/]/).some(part => part.startsWith('.env'));
  function scanBundle(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      assert.ok(!environmentFile(entry.name), 'Environment files must never be packaged');
      if (entry.isDirectory()) scanBundle(path.join(directory, entry.name));
    }
  }
  scanBundle(bundle);
  const packagedPaths = asar.listPackage(path.join(bundle, 'Contents/Resources/app.asar'));
  assert.ok(packagedPaths.every(name => !environmentFile(name)), 'Environment files must never enter app.asar');
  const blockmaps = archives.map(name => `${name}.blockmap`).filter(name => fs.existsSync(path.join(release, name)));
  assert.ok(blockmaps.length > 0, 'Expected at least one builder-generated archive blockmap');
  for (const name of blockmaps) regularFile(name);
  const inputs = new Map([...archives, ...blockmaps, 'latest-mac.yml'].map(name => [name, regularFile(name)]));
  inputs.set('build-manifest.json', path.join(root, 'build-manifest.json'));
  inputs.set('packaged-verification.json', path.join(release, 'packaged-verification.json'));
  // All checks finish before constructing the allowlisted upload directory.
  fs.mkdirSync(output);
  const hashes = {};
  for (const [name, file] of inputs) {
    fs.copyFileSync(file, path.join(output, name));
    hashes[name] = digest(path.join(output, name));
  }
  fs.writeFileSync(path.join(output, 'SHA256SUMS'), Object.keys(hashes).sort().map(name => `${hashes[name]}  ${name}\n`).join(''));
  hashes.SHA256SUMS = digest(path.join(output, 'SHA256SUMS'));
  const provenance = {
    schemaVersion: 1, version: pkg.version, buildId: manifest.buildId, commit,
    runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT,
    runUrl: `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`,
    node: process.version, platform: process.platform, arch: process.arch,
    signing: 'adhoc', testOnly: true, nativeQA: 'pending', sha256: hashes,
  };
  fs.writeFileSync(path.join(output, 'release-provenance.json'), JSON.stringify(provenance, null, 2));
  return provenance;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const result = collectReleaseAssets(process.cwd(), { commit });
  console.log(`Checked ${Object.keys(result.sha256).length} assets for ${result.buildId}; native QA pending.`);
}
