import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

type AcceptanceProfileOptions = { markerPath: string; buildId: string; defaultStateDir: string };
const invalid = (detail: string) => new Error(`The isolated acceptance launch was refused: ${detail}`);

function canonicalAbsolute(value: unknown): string {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.resolve(value) !== value || value.includes('\0')) throw invalid('use an unambiguous absolute state directory.');
  let actual: string;
  try { actual = fs.realpathSync(value); } catch { throw invalid('the state directory must already exist.'); }
  if (actual !== value) throw invalid('symlinked paths are not allowed.');
  return actual;
}

function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/**
 * A one-use operator marker chooses an isolated backend AND browser profile before
 * either is opened. It never changes an app bundle or reads/copies saved credentials.
 * Missing/other-build markers leave the ordinary launch unchanged; invalid matching
 * markers throw so the caller must abort rather than fall back to the real profile.
 * A successful rename retains the complete operator marker as a sibling receipt.
 */
export function consumeAcceptanceProfile(options: AcceptanceProfileOptions): string | undefined {
  const markerPath = options.markerPath;
  if (!path.isAbsolute(markerPath) || path.resolve(markerPath) !== markerPath) throw invalid('the marker path must be absolute.');
  let metadata: fs.Stats;
  try { metadata = fs.lstatSync(markerPath); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw invalid('the marker could not be inspected.'); }
  const uid = process.getuid?.();
  if (uid === undefined || !metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== uid || (metadata.mode & 0o7777) !== 0o600 || metadata.nlink !== 1 || metadata.size > 8192) throw invalid('the marker must be an owner-only regular file.');
  if (fs.realpathSync(markerPath) !== markerPath) throw invalid('symlinked marker paths are not allowed.');
  const markerParent = fs.lstatSync(path.dirname(markerPath));
  if (!markerParent.isDirectory() || markerParent.uid !== uid || (markerParent.mode & 0o022) !== 0) throw invalid('the marker directory must be controlled by its owner.');

  let marker: Record<string, unknown>;
  let opened: fs.Stats;
  const descriptor = fs.openSync(markerPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    opened = fs.fstatSync(descriptor);
    if (opened.dev !== metadata.dev || opened.ino !== metadata.ino || opened.uid !== uid || (opened.mode & 0o7777) !== 0o600 || opened.nlink !== 1) throw invalid('the marker changed while it was inspected.');
    const bytes = Buffer.alloc(8193), count = fs.readSync(descriptor, bytes, 0, bytes.length, 0);
    if (count > 8192) throw invalid('the marker exceeds its size limit.');
    try { marker = JSON.parse(bytes.subarray(0, count).toString('utf8')); } catch { throw invalid('the marker contains invalid JSON.'); }
  } finally { fs.closeSync(descriptor); }
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) throw invalid('the marker contains an invalid record.');
  if (marker.buildId !== options.buildId) return;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(options.buildId) || marker.schemaVersion !== 1 || Object.keys(marker).some(key => !['schemaVersion', 'buildId', 'stateDirectory'].includes(key))) throw invalid('the matching marker has an unsupported schema or build identity.');

  const directory = canonicalAbsolute(marker.stateDirectory);
  const state = fs.lstatSync(directory);
  if (!state.isDirectory() || state.uid !== uid || (state.mode & 0o7777) !== 0o700) throw invalid('the state directory must be private and owned by the current account.');
  if (!path.isAbsolute(options.defaultStateDir)) throw invalid('the ordinary profile path must be absolute.');
  let ordinary = path.resolve(options.defaultStateDir);
  try { ordinary = fs.realpathSync(ordinary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw invalid('the ordinary profile could not be inspected.'); }
  if (isWithin(ordinary, directory) || isWithin(directory, ordinary)) throw invalid('the acceptance and ordinary profiles must be separate directories.');

  const current = fs.lstatSync(markerPath);
  if (current.dev !== opened.dev || current.ino !== opened.ino || current.uid !== uid || current.mode !== opened.mode || current.nlink !== 1 || current.size !== opened.size || current.mtimeMs !== opened.mtimeMs || current.ctimeMs !== opened.ctimeMs) throw invalid('the marker changed before it could be consumed.');
  const receipt = path.join(path.dirname(markerPath), `${path.basename(markerPath, '.json')}.used-${options.buildId}-${randomUUID()}.json`);
  fs.renameSync(markerPath, receipt);
  return directory;
}
