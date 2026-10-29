import { createHash } from 'node:crypto';
import type { AgentExecutionBinding } from '../shared/agent-contracts.ts';
export type { AgentExecutionBinding } from '../shared/agent-contracts.ts';

/** Retained implementation authority, not a credential or a grant to execute. */
const HASH = /^[a-f\d]{64}$/i;
const EFFECTS = new Set(['read', 'local-write', 'external-write']);
const MAX_NODES = 4000, MAX_DEPTH = 16, MAX_BYTES = 64_000;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export function validAgentExecutionBinding(value: unknown): value is AgentExecutionBinding {
  if (!plain(value) || Object.keys(value).some(key => !['version', 'executorIdentity', 'toolSchemaHash'].includes(key))) return false;
  return own(value, 'version') === 1 && hash(own(value, 'executorIdentity')) !== undefined && hash(own(value, 'toolSchemaHash')) !== undefined;
}

function plain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

/** Read only own data properties. Neither helpers nor schemas may execute accessors. */
function own(value: object, key: string): unknown {
  const field = Object.getOwnPropertyDescriptor(value, key);
  return field && 'value' in field ? field.value : undefined;
}

function hash(value: unknown): string | undefined {
  return typeof value === 'string' && value.length === 64 && HASH.test(value) ? value.toLowerCase() : undefined;
}

/**
 * Call once with identity from the launcher's verified package manifest.
 * This helper validates shape; it does not independently verify a manifest or bundle.
 */
export function createAgentExecutorIdentity(input: unknown): string | undefined {
  try {
    if (!plain(input)) return undefined;
    const sourceHash = hash(own(input, 'sourceHash')), backendBuildId = hash(own(input, 'backendBuildId'));
    if (!sourceHash || !backendBuildId) return undefined;
    return digest(JSON.stringify({ version: 1, sourceHash, backendBuildId }));
  } catch { return undefined; }
}

/** Canonical bounded JSON, without consulting toJSON methods or object accessors. */
function canonicalSchema(value: unknown): string | undefined {
  const active = new Set<object>();
  let nodes = 0, bytes = 0;
  const part = (text: string) => {
    bytes += Buffer.byteLength(text, 'utf8');
    if (bytes > MAX_BYTES) throw new Error('Schema exceeds its supported bounds.');
    return text;
  };
  const visit = (item: unknown, depth: number): string => {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) throw new Error('Schema exceeds its supported bounds.');
    if (item === null || typeof item === 'boolean') return part(JSON.stringify(item));
    if (typeof item === 'number' && Number.isFinite(item)) return part(JSON.stringify(item));
    if (typeof item === 'string' && item.length <= MAX_BYTES && !item.includes('\0')) return part(JSON.stringify(item));
    if (!item || typeof item !== 'object' || active.has(item) || Object.getOwnPropertySymbols(item).length) throw new Error('Schema must be finite JSON.');
    if (!Array.isArray(item) && !plain(item)) throw new Error('Schema must be plain JSON.');
    active.add(item);
    try {
      if (Array.isArray(item)) {
        if (item.length > MAX_NODES || Object.keys(item).length !== item.length) throw new Error('Schema arrays must be bounded and dense.');
        const values: string[] = [];
        for (let index = 0; index < item.length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
          if (!descriptor || !('value' in descriptor)) throw new Error('Schema cannot execute accessors.');
          values.push(visit(descriptor.value, depth + 1));
        }
        if (values.length > 1) part(','.repeat(values.length - 1));
        return part('[') + values.join(',') + part(']');
      }
      const keys = Object.keys(item);
      if (keys.length > MAX_NODES) throw new Error('Schema exceeds its supported bounds.');
      const entries = keys.sort().map(key => {
        if (key.length > MAX_BYTES || key.includes('\0')) throw new Error('Schema keys must be bounded text.');
        const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
        if (!('value' in descriptor)) throw new Error('Schema cannot execute accessors.');
        return part(JSON.stringify(key)) + part(':') + visit(descriptor.value, depth + 1);
      });
      if (entries.length > 1) part(','.repeat(entries.length - 1));
      return part('{') + entries.join(',') + part('}');
    } finally { active.delete(item); }
  };
  try {
    if (!plain(value)) return undefined;
    const result = visit(value, 0);
    return Buffer.byteLength(result, 'utf8') <= MAX_BYTES ? result : undefined;
  } catch { return undefined; }
}

/** Snapshot a tool's declarative identity; function text is deliberately not proof of code identity. */
export function createAgentExecutionBinding(executor: unknown, tool: unknown): AgentExecutionBinding | undefined {
  try {
    const executorIdentity = hash(executor);
    if (!executorIdentity || !plain(tool)) return undefined;
    const name = own(tool, 'name'), effect = own(tool, 'effect');
    if (typeof name !== 'string' || !/^[a-z][a-z\d_.:-]{0,119}$/i.test(name) || typeof effect !== 'string' || !EFFECTS.has(effect)) return undefined;
    const schema = canonicalSchema(own(tool, 'inputSchema'));
    if (schema === undefined) return undefined;
    const toolSchemaHash = digest(`{"version":1,"name":${JSON.stringify(name)},"effect":${JSON.stringify(effect)},"inputSchema":${schema}}`);
    return Object.freeze({ version: 1, executorIdentity, toolSchemaHash });
  } catch { return undefined; }
}
