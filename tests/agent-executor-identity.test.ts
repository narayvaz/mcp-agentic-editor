import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentExecutionBinding, createAgentExecutorIdentity } from '../server/agent-executor-identity.ts';

const sourceHash = 'a'.repeat(64), backendBuildId = 'b'.repeat(64);
const executor = createAgentExecutorIdentity({ sourceHash, backendBuildId })!;
const tool = (inputSchema: unknown = { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] }) => ({ name: 'report.retain', effect: 'local-write', inputSchema });

test('executor identity is stable across verified metadata ordering and irrelevant timestamps', () => {
  assert.match(executor, /^[a-f\d]{64}$/);
  assert.equal(executor, createAgentExecutorIdentity({ backendBuildId, builtAt: 'a later timestamp', sourceHash }));
  assert.equal(executor, createAgentExecutorIdentity({ sourceHash: sourceHash.toUpperCase(), backendBuildId: backendBuildId.toUpperCase() }));
  assert.notEqual(executor, createAgentExecutorIdentity({ sourceHash: 'c'.repeat(64), backendBuildId }));
  assert.notEqual(executor, createAgentExecutorIdentity({ sourceHash, backendBuildId: 'c'.repeat(64) }));
});

test('missing, malformed or accessor-backed package identity cannot authorize an executor', () => {
  for (const input of [undefined, null, [], {}, { sourceHash }, { sourceHash, backendBuildId: '' }, { sourceHash, backendBuildId: 'b'.repeat(63) }, { sourceHash: 'z'.repeat(64), backendBuildId }, { sourceHash, backendBuildId: 123 }]) assert.equal(createAgentExecutorIdentity(input), undefined);
  let called = false;
  const accessor = { get sourceHash() { called = true; return sourceHash; }, backendBuildId };
  assert.equal(createAgentExecutorIdentity(accessor), undefined);
  assert.equal(called, false);
});

test('tool binding canonicalizes nested schema objects but preserves array ordering', () => {
  const binding = createAgentExecutionBinding(executor, tool())!;
  const reordered = tool({ required: ['title'], properties: { title: { type: 'string' } }, type: 'object' });
  assert.deepEqual(binding, createAgentExecutionBinding(executor, reordered));
  assert.equal(binding.version, 1);
  assert.equal(binding.executorIdentity, executor);
  assert.match(binding.toolSchemaHash, /^[a-f\d]{64}$/);
  assert.notEqual(createAgentExecutionBinding(executor, tool({ enum: ['a', 'b'] }))!.toolSchemaHash, createAgentExecutionBinding(executor, tool({ enum: ['b', 'a'] }))!.toolSchemaHash);
});

test('executor, name, effect and input schema changes invalidate the binding', () => {
  const original = createAgentExecutionBinding(executor, tool())!;
  for (const descriptor of [{ ...tool(), name: 'report.replace' }, { ...tool(), effect: 'external-write' }, tool({ type: 'object', properties: { title: { type: 'number' } } })]) assert.notEqual(original.toolSchemaHash, createAgentExecutionBinding(executor, descriptor)!.toolSchemaHash);
  assert.notDeepEqual(original, createAgentExecutionBinding('c'.repeat(64), tool()));
});

test('binding snapshots metadata and does not inspect executable functions or their text', () => {
  const descriptor = tool();
  Object.defineProperty(descriptor, 'execute', { get() { throw new Error('Executable code must not be inspected.'); } });
  const binding = createAgentExecutionBinding(executor, descriptor)!;
  assert.ok(Object.isFrozen(binding));
  const before = structuredClone(binding);
  (descriptor.inputSchema as any).properties.title.type = 'number';
  assert.deepEqual(binding, before);
  assert.notEqual(binding.toolSchemaHash, createAgentExecutionBinding(executor, descriptor)!.toolSchemaHash);
});

test('invalid descriptors and non-JSON schemas fail closed without executing getters', () => {
  const cyclic: any = {}; cyclic.self = cyclic;
  const sparse = Array(2); sparse[1] = 'x';
  const schemas: unknown[] = [null, [], true, { x: undefined }, { x: NaN }, { x: Infinity }, { x: () => 1 }, { x: new Date() }, { x: '\0' }, cyclic, { x: sparse }, { [Symbol('x')]: 1 }];
  let called = false;
  schemas.push({ get property() { called = true; return 'x'; } });
  for (const schema of schemas) assert.equal(createAgentExecutionBinding(executor, tool(schema)), undefined);
  for (const descriptor of [undefined, null, [], {}, { ...tool(), name: '' }, { ...tool(), name: 'a'.repeat(121) }, { ...tool(), effect: 'execute' }]) assert.equal(createAgentExecutionBinding(executor, descriptor), undefined);
  for (const identity of [undefined, '', 'a'.repeat(63), 'z'.repeat(64)]) assert.equal(createAgentExecutionBinding(identity, tool()), undefined);
  assert.equal(called, false);
});

test('oversized, deeply nested and excessive-node schemas are rejected within fixed bounds', () => {
  let deep: any = {};
  for (let index = 0; index < 18; index++) deep = { child: deep };
  for (const schema of [{ description: 'x'.repeat(64_001) }, { description: 'ա'.repeat(40_000) }, deep, { enum: Array.from({ length: 4001 }, (_, i) => i) }]) assert.equal(createAgentExecutionBinding(executor, tool(schema)), undefined);
  assert.ok(createAgentExecutionBinding(executor, tool({ type: 'object', properties: { hy: { description: 'Հայերեն' } } })));
});
