import test from 'node:test';
import assert from 'node:assert/strict';
import { isAutonomousSelfModIntent } from '../server/assistant-intent';

test('the exact native question after past changes remains descriptive', () => {
  const prompt = 'I want to ask you the same things again after the changes we have made: describe me about yourself. I am asking you to be very detailed about you features, ui/ux, about every aspect of what and why you are created for.';
  assert.equal(isAutonomousSelfModIntent(prompt), false);
  assert.equal(isAutonomousSelfModIntent(prompt.slice(prompt.indexOf('describe me'))), false);
});

test('descriptive questions and past app changes do not request another modification', () => {
  for (const prompt of [
    'Describe your features, UI/UX, and why you were created.',
    'Explain how you improve your UI and what changed after the update.',
    'What changes can you make to yourself?',
    'Are you capable of modifying your own code?',
    'Can you modify yourself?',
    'Could you change your own UI in general?',
    'How would you redesign Azat Studio?',
    'What happens if I say "change your own code now"?',
    'We updated your code yesterday. Tell me what your features are now.',
    'After the improvements we made to this app, explain every feature.',
    'Describe your interface and explain which features you implement.',
    'Do not change this app. Just explain the sidebar.',
    'Go ahead and describe your features in detail.',
    'Proceed with explaining your UI and its design.',
  ]) assert.equal(isAutonomousSelfModIntent(prompt), false, prompt);
});

test('actual bounded app-change requests still redirect to Development', () => {
  for (const prompt of [
    'Change your sidebar color to blue.',
    'Please improve Azat Studio keyboard navigation.',
    'Fix the bug in this app now.',
    'I want you to implement search in the sidebar.',
    'I want to add search to this app.',
    "I'd like you to fix your sidebar keyboard focus.",
    'You should improve your UI contrast.',
    'Could you add a search tab to this app?',
    'Can you change your UI to dark mode?',
    'Can you modify yourself now?',
    'Update your own code.',
    'Replace the placeholder in the dashboard.',
    'Go ahead and apply it to Azat Studio.',
    'Initiate self-modification.',
    'Start self modification now.',
    'The sidebar is unreadable; fix it.',
    'In this app, please add keyboard shortcuts.',
    'Describe your features, then change your sidebar color to blue.',
    'Explain your features; please change your icons afterwards.',
  ]) assert.equal(isAutonomousSelfModIntent(prompt), true, prompt);
});

test('editorial requests mentioning an app or agent remain in the assistant', () => {
  for (const prompt of [
    'Fix this article about an AI agent.',
    'Improve the draft about Azat Studio.',
    'Change the headline describing your app.',
    'Add sources to this article about Azat Studio.',
    'Translate the phrase "change your own code now".',
    'Describe the changes in the sidebar.',
    'Tell me about the changes in this app now.',
    '',
  ]) assert.equal(isAutonomousSelfModIntent(prompt), false, prompt);
});
