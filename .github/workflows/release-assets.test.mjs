import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { collectReleaseAssets } from './release-assets.mjs';
const require = createRequire(import.meta.url), asar = require('@electron/asar');
const options = { commit: 'a'.repeat(40), env: { GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_REPOSITORY: 'owner/repo' } };
async function fixture(run, { environmentFile = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'azat-release-assets-'));
  try {
    const release = path.join(root, 'release'), resources = path.join(release, 'mac-arm64/Azat Studio.app/Contents/Resources');
    const source = path.join(root, 'asar-input');
    fs.mkdirSync(resources, { recursive: true });fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, environmentFile ? '.env.production' : 'index.js'), 'fixture');
    await asar.createPackage(source, path.join(resources, 'app.asar'));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '0.2.0' }));
    fs.writeFileSync(path.join(root, 'build-manifest.json'), JSON.stringify({ appVersion: '0.2.0', buildId: '0.2.0-fixture' }));
    fs.writeFileSync(path.join(release, 'packaged-verification.json'), JSON.stringify({ buildId: '0.2.0-fixture', passed: true }));
    const files = ['zip', 'dmg'].map(ext => {
      const name = `Azat-Studio-0.2.0-arm64.${ext}`, data = Buffer.from(`fixture-${ext}`);
      fs.writeFileSync(path.join(release, name), data);
      return { url: name, size: data.length, sha512: crypto.createHash('sha512').update(data).digest('base64') };
    });
    fs.writeFileSync(path.join(release, 'latest-mac.yml'), JSON.stringify({ version: '0.2.0', files }));
    fs.writeFileSync(path.join(release, 'Azat-Studio-0.2.0-arm64.dmg.blockmap'), 'fixture-map');
    fs.writeFileSync(path.join(release, 'unrelated-secret.txt'), 'must not be uploaded');
    await run(root, release);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
test('collector keeps only checked archives/feed/blockmaps and provenance with independent hashes', () => fixture(root => {
  const result = collectReleaseAssets(root, options), output = path.join(root, 'release/checked-release');
  assert.equal(result.nativeQA, 'pending');assert.equal(result.signing, 'adhoc');
  assert.ok(!fs.existsSync(path.join(output, 'unrelated-secret.txt')));
  for (const [name, hash] of Object.entries(result.sha256)) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(output, name))).digest('hex'), hash);
  assert.throws(() => collectReleaseAssets(root, options), /previous artifact/);
}));
test('collector refuses an archive changed after update metadata was generated', () => fixture((root, release) => {
  fs.appendFileSync(path.join(release, 'Azat-Studio-0.2.0-arm64.zip'), 'tamper');
  assert.throws(() => collectReleaseAssets(root, options), /checksum differs/);
  assert.ok(!fs.existsSync(path.join(root, 'release/checked-release')));
}));
test('collector rejects environment files inside ASAR', () => fixture(root => {
  assert.throws(() => collectReleaseAssets(root, options), /Environment files/);
}, { environmentFile: true }));
test('collector rejects traversal/remote update URLs and mismatched build verification', () => fixture((root, release) => {
  const feed = JSON.parse(fs.readFileSync(path.join(release, 'latest-mac.yml')));
  feed.files[0].url = '../outside.zip';fs.writeFileSync(path.join(release, 'latest-mac.yml'), JSON.stringify(feed));
  assert.throws(() => collectReleaseAssets(root, options), /Unexpected update feed URL/);
  fs.writeFileSync(path.join(release, 'packaged-verification.json'), JSON.stringify({ buildId: 'different', passed: true }));
  assert.throws(() => collectReleaseAssets(root, options), /different/);
}));
test('collector refuses symlink assets and missing blockmaps', () => fixture((root, release) => {
  const map = path.join(release, 'Azat-Studio-0.2.0-arm64.dmg.blockmap');
  fs.unlinkSync(map);assert.throws(() => collectReleaseAssets(root, options), /blockmap/);
  fs.symlinkSync('Azat-Studio-0.2.0-arm64.zip', map);
  assert.throws(() => collectReleaseAssets(root, options), /regular asset/);
}));
