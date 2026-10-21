import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function releaseManifestPath(packaged: boolean, appRoot: string, resourcesPath: string) {
  return path.join(packaged ? resourcesPath : appRoot, 'build-manifest.json');
}

export function verifyReleaseArtifacts(appRoot: string, manifest: any, read = (file: string) => fs.readFileSync(file)) {
  if (!manifest?.buildId || !manifest.files || !Object.keys(manifest.files).length) throw new Error('The release manifest is missing. Rebuild the complete application.');
  for (const [relative, expected] of Object.entries(manifest.files)) {
    if (relative.startsWith('/') || relative.split('/').includes('..')) throw new Error('Invalid release manifest path.');
    const actual = createHash('sha256').update(read(path.join(appRoot, relative))).digest('hex');
    if (actual !== expected) throw new Error(`The installed release failed verification: ${relative}`);
  }
}
