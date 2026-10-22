import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { consumeAcceptanceProfile } from '../electron/acceptance-profile.ts';

function fixture(t: { after(fn: () => void): void }) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'studio-acceptance-'));
  fs.chmodSync(root, 0o700); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ordinary = path.join(root, 'ordinary'), isolated = path.join(root, 'isolated');
  fs.mkdirSync(ordinary, { mode: 0o700 }); fs.mkdirSync(isolated, { mode: 0o700 });
  const markerPath = path.join(root, 'acceptance-launch.json'), buildId = '0.3.0-1234abcd';
  const write = (change: Record<string, unknown> = {}) => fs.writeFileSync(markerPath, JSON.stringify({ schemaVersion: 1, buildId, stateDirectory: isolated, ...change }), { mode: 0o600 });
  const consume = () => consumeAcceptanceProfile({ markerPath, buildId, defaultStateDir: ordinary });
  return { root, ordinary, isolated, markerPath, buildId, write, consume };
}

test('ordinary launch ignores absent or other-build markers without consuming them', t => {
  const f = fixture(t); assert.equal(f.consume(), undefined);
  f.write({ buildId: 'older-build', schemaVersion: 2, stateDirectory: '/not-an-existing-directory' });
  assert.equal(f.consume(), undefined); assert.equal(fs.existsSync(f.markerPath), true);
  assert.equal(fs.readdirSync(f.root).some(name => name.includes('.used-')), false);
});

test('exact matching private profile is consumed once and preserved in an owner-only receipt', t => {
  const f = fixture(t); f.write(); const before = fs.readFileSync(f.markerPath, 'utf8');
  assert.equal(f.consume(), f.isolated); assert.equal(f.consume(), undefined);
  const receipts = fs.readdirSync(f.root).filter(name => name.startsWith(`acceptance-launch.used-${f.buildId}-`));
  assert.equal(receipts.length, 1);
  const receipt = path.join(f.root, receipts[0]);
  assert.equal(fs.readFileSync(receipt, 'utf8'), before); assert.equal(fs.statSync(receipt).mode & 0o777, 0o600);
});

test('matching malformed, unsupported and insecure markers fail closed without consumption', t => {
  const f = fixture(t);
  for (const change of [{ schemaVersion: 2 }, { extra: 'unknown' }, { stateDirectory: '' }, { stateDirectory: 'relative' }]) {
    f.write(change); assert.throws(f.consume, /refused/); assert.equal(fs.existsSync(f.markerPath), true);
  }
  f.write(); fs.chmodSync(f.markerPath, 0o644); assert.throws(f.consume, /owner-only/); fs.chmodSync(f.markerPath, 0o600);
  fs.writeFileSync(f.markerPath, '{not JSON'); assert.throws(f.consume, /invalid JSON/);
});

test('actual profile, nested profiles, ancestors and symlink aliases are denied', t => {
  const f = fixture(t);
  const nested = path.join(f.ordinary, 'nested'); fs.mkdirSync(nested, { mode: 0o700 });
  const alias = path.join(f.root, 'alias'); fs.symlinkSync(f.ordinary, alias);
  for (const stateDirectory of [f.ordinary, nested, f.root, alias, `${f.isolated}/../isolated`]) {
    f.write({ stateDirectory }); assert.throws(f.consume, /refused/); assert.equal(fs.existsSync(f.markerPath), true);
  }
});

test('public directories, missing directories, non-directory states and symlink markers are denied', t => {
  const f = fixture(t); f.write(); fs.chmodSync(f.isolated, 0o755); assert.throws(f.consume, /private/); fs.chmodSync(f.isolated, 0o700);
  f.write({ stateDirectory: path.join(f.root, 'missing') }); assert.throws(f.consume, /already exist/);
  f.write({ stateDirectory: f.markerPath }); assert.throws(f.consume, /private/);
  const target = path.join(f.root, 'marker-target.json'); f.write(); fs.renameSync(f.markerPath, target); fs.symlinkSync(target, f.markerPath);
  assert.throws(f.consume, /owner-only/); assert.equal(fs.readFileSync(target, 'utf8').includes(f.buildId), true);
});
