import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { releaseManifestPath, verifyReleaseArtifacts } from '../electron/release-integrity.ts';

test('packaged launch verifies external resources manifest and rejects changed artifacts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'azat-packaged-integrity-'));
  try {
    const resources = path.join(root, 'Contents/Resources'), appRoot = path.join(resources, 'app.asar');
    fs.mkdirSync(appRoot, { recursive: true });
    const artifact = path.join(appRoot, 'main.js');
    fs.writeFileSync(artifact, 'verified');
    const manifest = { buildId: 'test-release', files: { 'main.js': createHash('sha256').update('verified').digest('hex') } };
    fs.writeFileSync(path.join(resources, 'build-manifest.json'), JSON.stringify(manifest));
    assert.equal(fs.existsSync(path.join(appRoot, 'build-manifest.json')), false);
    const loaded = JSON.parse(fs.readFileSync(releaseManifestPath(true, appRoot, resources), 'utf8'));
    verifyReleaseArtifacts(appRoot, loaded);
    fs.writeFileSync(artifact, 'changed');
    assert.throws(() => verifyReleaseArtifacts(appRoot, loaded), /failed verification/);
    assert.equal(releaseManifestPath(false, appRoot, resources), path.join(appRoot, 'build-manifest.json'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
