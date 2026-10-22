import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

/** Validate permissions from the signed executable, rather than the packaging config. */
export function assertMacVoiceEntitlements({ entitlements, hardenedRuntime, microphoneUsageDescription }) {
  if (!hardenedRuntime) throw new Error('The packaged executable must retain hardened runtime.');
  if (!entitlements || typeof entitlements !== 'object' || entitlements['com.apple.security.device.audio-input'] !== true) throw new Error('The signed executable is missing its audio-input entitlement.');
  if ('com.apple.security.device.camera' in entitlements) throw new Error('Studio voice must not request a camera entitlement.');
  if (typeof microphoneUsageDescription !== 'string' || !microphoneUsageDescription.trim()) throw new Error('The packaged app is missing its microphone purpose text.');
}

export function verifyMacVoiceBundle(bundle) {
  const info = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(bundle, 'Contents/Info.plist')], { encoding: 'utf8' }));
  const frameworks = path.join(bundle, 'Contents/Frameworks');
  const executables = [bundle, ...fs.readdirSync(frameworks).filter(name => name.endsWith('.app')).map(name => path.join(frameworks, name))];
  for (const executable of executables) {
    const xml = execFileSync('/usr/bin/codesign', ['-d', '--entitlements', '-', '--xml', executable], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const entitlements = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], { input: xml, encoding: 'utf8' }));
    // codesign writes signature metadata to stderr; collect it without logging app paths.
    const signature = spawnSync('/usr/bin/codesign', ['-d', '--verbose=4', executable], { encoding: 'utf8' });
    if (signature.error || signature.status !== 0) throw new Error('The packaged executable signature could not be inspected.');
    assertMacVoiceEntitlements({ entitlements, hardenedRuntime: /flags=0x[\da-f]+\([^\n)]*\bruntime\b/i.test(signature.stdout + signature.stderr), microphoneUsageDescription: info.NSMicrophoneUsageDescription });
  }
  return { microphoneEntitlementVerified: true, hardenedRuntime: true, cameraEntitlement: false, signedExecutablesVerified: executables.length };
}
