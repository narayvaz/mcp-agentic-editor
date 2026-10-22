import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmAgentDraftText } from '../server/agent-draft-quality';
import { ModelRequestError } from '../server/model-client';

test('multilingual draft screen allows names, acronyms, citations and native punctuation', () => {
  const armenian = 'Բովանդակության ծագումն ու փոփոխությունները ստուգելու համար C2PA-ի գործիքները կարող են օգնել լրագրողներին։ ';
  assert.doesNotThrow(() => confirmAgentDraftText(armenian + '[3596d719c4320f6857f61868]', 'hy'));
  assert.doesNotThrow(() => confirmAgentDraftText('Проверка происхождения материалов C2PA помогает редакции сохранять сведения об изменениях и источниках.', 'ru'));
  assert.doesNotThrow(() => confirmAgentDraftText('C2PA records provenance information; editorial verification of the underlying claims still requires review.', 'en'));
});

test('corrupt Unicode, hybrid words and the wrong dominant language cannot pass as a requested draft', () => {
  const base = 'Բովանդակության ծագումն ու փոփոխությունները ստուգելու համար անհրաժեշտ են աղբյուրներ։ ';
  for (const bad of [base + 'խｅտ', base + 'ստուգելtest', base + '\uFFFD', base + '\uD800', base + '\u0000', 'This entire article is English despite a request for a complete Armenian article.']) {
    assert.throws(() => confirmAgentDraftText(bad, 'hy'), (issue: unknown) => issue instanceof ModelRequestError && issue.code === 'MODEL_EMPTY_OUTPUT');
  }
  assert.throws(() => confirmAgentDraftText('The pаssage contains a Cyrillic letter inside an English word, a common mixed-script corruption.', 'en'), ModelRequestError);
});
