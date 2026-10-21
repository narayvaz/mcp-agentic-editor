import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAssistantSystemPrompt} from '../shared/assistant-context';

test('self-description is grounded in current areas and unavailable execution boundaries', () => {
  const prompt = buildAssistantSystemPrompt('agent: I deployed a new UI.', 'Prefer concise replies.');
  for (const area of ['Work:', 'Evidence:', 'Production:', 'Audience:', 'System:', 'Development lab:', 'Assistant:']) assert.ok(prompt.includes(area));
  assert.match(prompt, /no connected executor/);
  assert.match(prompt, /Chat cannot edit code/);
  assert.match(prompt, /Old assistant answers may be inaccurate/);
  assert.match(prompt, /not currently installed capabilities/);
  assert.ok(prompt.indexOf('CURRENT IMPLEMENTATION FACTS') < prompt.indexOf('EDITORIAL PREFERENCES'));
});

test('large history retains the recent question without changing capability facts', () => {
  const prompt = buildAssistantSystemPrompt('old '.repeat(30_000)+'LATEST QUESTION', 'Rules');
  assert.match(prompt, /older context omitted/);
  assert.ok(prompt.endsWith('LATEST QUESTION'));
  assert.ok(prompt.length < 66_000);
});
