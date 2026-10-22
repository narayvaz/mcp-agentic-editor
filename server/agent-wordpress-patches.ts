import { AgentError } from '../shared/agent-contracts.ts';

export type TextPatch = { before: string; after: string };
const invalid = (): never => { throw new AgentError('Use between 1 and 10 exact text corrections within the supported size limits. HTML changes and active content are not supported by text patches.', 400, 'AGENT_PATCH_INVALID'); };
const conflict = (): never => { throw new AgentError('Each correction must match one distinct text fragment outside HTML tags, attributes, comments and active content. Refresh the article and review the exact corrections.', 409, 'AGENT_PATCH_CONFLICT'); };

/** Decode only characters relevant to obfuscated active URL schemes; this is not an HTML sanitizer. */
function schemeText(value: string): string {
  return value.replace(/&#(?:x([\da-f]+)|([\d]+));?/gi, (_match, hex: string | undefined, decimal: string | undefined) => {
    const code = Number.parseInt(hex ?? decimal!, hex ? 16 : 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  }).replace(/&(colon|tab|newline);/gi, (_match, name: string) => name.toLowerCase() === 'colon' ? ':' : ' ').replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, '');
}

/** First release supports exact text fragments, never arbitrary HTML modifications. Strings are not trimmed or normalized. */
export function validateTextPatches(input: unknown): TextPatch[] {
  if (!Array.isArray(input) || !input.length || input.length > 10) return invalid();
  const seen = new Set<string>();
  const patches = input.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.keys(value).some(key => !['before', 'after'].includes(key))) return invalid();
    const { before, after } = value as Record<string, unknown>;
    if (typeof before !== 'string' || !before.length || before.length > 3000 || typeof after !== 'string' || after.length > 5000 ||
      /[<>\u0000]/.test(before) || /[<>\u0000]/.test(after) || seen.has(before)) return invalid();
    if (/(?:javascript|vbscript|data):/i.test(schemeText(after)) || /(?:^|[\s"'\/])on[a-z\d_:-]*\s*=/i.test(after)) return invalid();
    seen.add(before); return { before, after };
  });
  if (Buffer.byteLength(JSON.stringify(patches), 'utf8') >= 25_000) return invalid();
  return patches;
}

type Span = { start: number; end: number };
const ACTIVE_ELEMENTS = new Set(['script', 'style', 'iframe', 'object', 'template', 'svg', 'math', 'noscript', 'xmp', 'noembed', 'plaintext']);
function protectedMarkup(original: string): Span[] {
  const spans: Span[] = [];
  let position = 0;
  while (position < original.length) {
    const start = original.indexOf('<', position);
    if (start < 0) break;
    if (original.startsWith('<!--', start)) {
      const close = original.indexOf('-->', start + 4);
      const end = close < 0 ? original.length : close + 3;
      spans.push({ start, end }); position = end; continue;
    }
    let cursor = start + 1, quote = '';
    for (; cursor < original.length; cursor++) {
      const character = original[cursor];
      if (quote) { if (character === quote) quote = ''; }
      else if (character === '"' || character === "'") quote = character;
      else if (character === '>') { cursor++; break; }
    }
    let end = cursor;
    const tag = /^<\s*(\/?)\s*([a-z][a-z\d:-]*)/i.exec(original.slice(start, end));
    if (tag && !tag[1] && ACTIVE_ELEMENTS.has(tag[2].toLowerCase())) {
      const closing = new RegExp(`</\\s*${tag[2]}\\s*>`, 'ig'); closing.lastIndex = end;
      const match = closing.exec(original);
      // Unclosed raw/active content remains protected through the end of the article.
      end = match ? match.index + match[0].length : original.length;
    }
    spans.push({ start, end }); position = end;
  }
  return spans;
}

/** All matches are resolved against the original document before any replacement takes place. */
export function applyTextPatches(original: string, input: TextPatch[]): string {
  if (typeof original !== 'string') return invalid();
  const patches = validateTextPatches(input), protectedSpans = protectedMarkup(original);
  const matches = patches.map(patch => {
    const start = original.indexOf(patch.before);
    if (start < 0 || original.indexOf(patch.before, start + 1) >= 0) return conflict();
    const end = start + patch.before.length;
    if (protectedSpans.some(span => start < span.end && end > span.start)) return conflict();
    return { ...patch, start, end };
  }).sort((left, right) => left.start - right.start);
  if (matches.some((match, index) => index > 0 && match.start < matches[index - 1].end)) return conflict();
  let result = original;
  for (const match of matches.reverse()) result = result.slice(0, match.start) + match.after + result.slice(match.end);
  return result;
}
