import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentError } from '../shared/agent-contracts.ts';
import { applyTextPatches, validateTextPatches } from '../server/agent-wordpress-patches.ts';

const invalid = (issue: unknown) => issue instanceof AgentError && issue.code === 'AGENT_PATCH_INVALID';
const conflict = (issue: unknown) => issue instanceof AgentError && issue.code === 'AGENT_PATCH_CONFLICT';

test('exact Armenian and Russian corrections preserve all surrounding Unicode, whitespace and HTML', () => {
  const original = '<!-- wp:paragraph -->\n<p class="report">Հայաստանի մայրաքաղաքը Երեվանն է։  Հայտարարությունը՝ «պաշտոնական»։</p>\n<p lang="ru">Встреча состоится в Арменяи — завтра.\u00a0Имена: Անահիտ / Анна.</p>\n<!-- /wp:paragraph -->';
  const patches = [{ before: 'Երեվանն', after: 'Երևանն' }, { before: 'Арменяи', after: 'Армении' }];
  const updated = applyTextPatches(original, patches);
  assert.equal(updated, original.replace('Երեվանն', 'Երևանն').replace('Арменяи', 'Армении'));
  assert.ok(updated.includes('  Հայտարարությունը՝ «պաշտոնական»։')); assert.ok(updated.includes('\u00a0Имена: Անահիտ / Анна.'));
  assert.deepEqual(patches, [{ before: 'Երեվանն', after: 'Երևանն' }, { before: 'Арменяи', after: 'Армении' }]);
});

test('patches resolve against the original once and never chain newly inserted text', () => {
  assert.equal(applyTextPatches('alpha / beta', [{ before: 'alpha', after: 'beta' }, { before: 'beta', after: 'gamma' }]), 'beta / gamma');
  assert.equal(applyTextPatches('first middle last', [{ before: 'last', after: '' }, { before: 'first', after: 'FIRST' }]), 'FIRST middle ');
  assert.equal(applyTextPatches('abcdef', [{ before: 'ab', after: 'X' }, { before: 'cd', after: 'Y' }, { before: 'ef', after: 'Z' }]), 'XYZ');
});

test('missing, ambiguous, duplicate and overlapping original matches fail without returning a partial edit', () => {
  for (const [original, patches] of [
    ['unique text', [{ before: 'absent', after: 'replacement' }]],
    ['repeat repeat', [{ before: 'repeat', after: 'once' }]],
    ['aaa', [{ before: 'aa', after: 'a' }]],
    ['abcdef', [{ before: 'abc', after: 'A' }, { before: 'cde', after: 'B' }]],
  ] as [string, { before: string; after: string }[]][]) assert.throws(() => applyTextPatches(original, patches), conflict);
  assert.throws(() => validateTextPatches([{ before: 'same', after: 'one' }, { before: 'same', after: 'two' }]), invalid);
});

test('validation preserves exact strings and enforces per-patch and total UTF-8 bounds', () => {
  const exact = [{ before: ' exact\nfragment ', after: '  replacement\n' }]; assert.deepEqual(validateTextPatches(exact), exact);
  assert.equal(validateTextPatches([{ before: 'x'.repeat(3000), after: 'y'.repeat(5000) }])[0].after.length, 5000);
  assert.equal(validateTextPatches(Array.from({ length: 10 }, (_, index) => ({ before: `fragment-${index}`, after: '' }))).length, 10);
  for (const value of [undefined, {}, [], Array.from({ length: 11 }, (_, index) => ({ before: String(index), after: '' })),
    [{ before: '', after: 'value' }], [{ before: 'x'.repeat(3001), after: '' }], [{ before: 'x', after: 'y'.repeat(5001) }],
    [{ before: 'x', after: '', extra: 'ignored' }], [{ before: 'x' }], [{ before: 'x', after: 42 }],
    [{ before: 'bad\0text', after: 'good' }], [{ before: 'good', after: '\0' }],
    Array.from({ length: 10 }, (_, index) => ({ before: `old-${index}`, after: 'ա'.repeat(1500) })),
  ]) assert.throws(() => validateTextPatches(value), invalid);
  const sized = (bytes: number) => {
    const patches = Array.from({ length: 5 }, (_, index) => ({ before: `old-${index}`, after: '' }));
    let remaining = bytes - Buffer.byteLength(JSON.stringify(patches));
    for (const patch of patches) { const count = Math.min(5000, remaining); patch.after = 'x'.repeat(count); remaining -= count; }
    assert.equal(remaining, 0); assert.equal(Buffer.byteLength(JSON.stringify(patches)), bytes); return patches;
  };
  assert.equal(validateTextPatches(sized(24_999)).length, 5);
  assert.throws(() => validateTextPatches(sized(25_000)), invalid);
});

test('text-only patches reject new tags, event attributes and encoded active URL schemes', () => {
  for (const after of ['<script>alert(1)</script>', '<STYLE>body{display:none}</STYLE>', '<iframe src="https://example.org"></iframe>',
    '<object></object>', '<embed>', '<link href="x">', '<base href="x">', '<meta http-equiv="refresh">',
    '<img src=x onerror=alert(1)>', 'onclick="alert(1)"', 'onload = alert(1)',
    'javascript:alert(1)', 'JaVa\nScRiPt:alert(1)', 'java&#x73;cript&colon;alert(1)', '&#106;avascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=', 'vbscript:msgbox(1)',
  ]) assert.throws(() => validateTextPatches([{ before: 'original', after }]), invalid);
  assert.throws(() => validateTextPatches([{ before: '<p>Old</p>', after: 'New' }]), invalid);
});

test('patches cannot edit tag names, quoted attributes, comments or existing active content', () => {
  for (const [original, before, after] of [
    ['<p title="Old > value">Visible article</p>', 'Old', 'New'],
    ['<a href="javaXscript:alert(1)">Visible</a>', 'X', ''],
    ['<scrXipt>alert(1)</script><p>Visible</p>', 'X', ''],
    ['<!-- Old > comment -->\n<p>Visible</p>', 'Old', 'New'],
    ['<script>old_code()</script><p>Visible</p>', 'old_code', 'new_code'],
    ['<style>.old-class {color:red}</style><p>Visible</p>', 'old-class', 'new-class'],
    ['<IFRAME>old fallback</IFRAME><p>Visible</p>', 'old fallback', 'new fallback'],
    ['<script>unclosed old text', 'old', 'new'],
    ['<p title="unclosed old text', 'old', 'new'],
  ]) assert.throws(() => applyTextPatches(original, [{ before, after }]), conflict);
  assert.equal(applyTextPatches('<script>existing_code()</script><p>Old visible text</p>', [{ before: 'Old visible text', after: 'New visible text' }]), '<script>existing_code()</script><p>New visible text</p>');
});
