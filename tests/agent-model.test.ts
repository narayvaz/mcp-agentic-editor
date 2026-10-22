import test from 'node:test';
import assert from 'node:assert/strict';
import { agentDecisionRequest, confirmAgentResponse, createAgentDecider, normalizeAgentDecisionEnvelope } from '../server/agent-model';
import { validateAgentDecision } from '../server/agent-runtime';
import { generateWithBoundedFallback, ModelRequestError } from '../server/model-client';

test('a single model JSON fence is normalized without relaxing runtime validation', () => {
  const json = '{"kind":"ask","summary":"Needs scope","question":"Which question?"}';
  assert.equal(normalizeAgentDecisionEnvelope(`\n\`\`\`json\n${json}\n\`\`\`\n`), json);
  assert.equal(validateAgentDecision(normalizeAgentDecisionEnvelope(`\`\`\`json\n${json}\n\`\`\``)).kind, 'ask');
  assert.throws(() => validateAgentDecision(normalizeAgentDecisionEnvelope(`Done! ${json}`)));
  assert.throws(() => validateAgentDecision(normalizeAgentDecisionEnvelope('```json\n{"kind":"tool","tool":"shell","summary":"Unsafe","arguments":{"command":"run"},"approved":true}\n```')));
});

test('a saved plan tells the coordinator to execute instead of asking it to begin planning again', async () => {
  const prompts: string[] = [];
  const decide = createAgentDecider(async (prompt, signal) => { assert.equal(signal.aborted, false); prompts.push(prompt); return '{"kind":"ask","summary":"Need scope","question":"Which source?"}'; });
  const base = { instruction: 'Research a source', plan: [], steps: [], artifacts: [] } as any;
  await decide(base, [], new AbortController().signal);
  await decide({ ...base, plan: ['Capture source', 'Draft article'] }, [], new AbortController().signal);
  assert.match(prompts[0], /Begin with one short plan/);
  assert.match(prompts[1], /DO NOT return kind plan again/);
  assert.doesNotMatch(prompts[1], /Begin with one short plan/);
});

test('structured requests preserve cancellation and malformed primary decisions use only the configured fallback', async () => {
  const controller = new AbortController();
  const request = agentDecisionRequest({ model: 'gemma-4-26b-a4b-it', contents: [], config: { abortSignal: controller.signal, temperature: 0.2 } });
  assert.equal(request.config.abortSignal, controller.signal);
  assert.equal(request.config.responseMimeType, 'application/json');
  assert.equal(request.config.thinkingConfig.thinkingLevel, 'minimal');
  assert.equal(request.config.maxOutputTokens, 4096);
  const calls: string[] = [];
  const result = await generateWithBoundedFallback({ models: { generateContent: async input => {
    calls.push(input.model);
    return confirmAgentResponse({ text: input.model === 'saved-primary' ? '{kind: plan}' : '{"kind":"finish","summary":"Done with confirmed receipts."}' });
  } } }, 'saved-primary', 'saved-fallback', [], 0.2, 2000);
  assert.deepEqual(calls, ['saved-primary', 'saved-fallback']);
  assert.equal(result.modelUsed, 'saved-fallback');
  assert.throws(() => confirmAgentResponse({ text: '{"kind":"tool","summary":"x","tool":"shell","arguments":{},"approved":true}' }), (issue: unknown) => issue instanceof ModelRequestError && issue.code === 'MODEL_EMPTY_OUTPUT');
});
