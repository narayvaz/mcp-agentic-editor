import { ModelRequestError } from './model-client';

/** An encoding/script screen, not a factual, fluency or translation-parity judgment. */
export function confirmAgentDraftText(text: string, language: string): void {
  const fail = () => { throw new ModelRequestError('MODEL_EMPTY_OUTPUT'); };
  if (!text.trim() || /\uFFFD|\p{Surrogate}|[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text)) fail();
  const prose = text.replace(/https?:\/\/\S+|\[[a-f\d]{24}\]/gi, '');
  for (const word of prose.match(/[\p{L}\p{M}]+/gu) ?? []) {
    const scripts = [/\p{Script=Armenian}/u, /\p{Script=Cyrillic}/u, /\p{Script=Latin}/u].filter(pattern => pattern.test(word));
    if (scripts.length > 1) fail();
  }
  const letters = prose.match(/\p{L}/gu) ?? [];
  const expected = language === 'hy' ? /\p{Script=Armenian}/u : language === 'ru' ? /\p{Script=Cyrillic}/u : /\p{Script=Latin}/u;
  if (letters.length < 40 || letters.filter(letter => expected.test(letter)).length / letters.length < 0.6) fail();
}
