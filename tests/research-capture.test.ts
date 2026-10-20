import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { capturePublicSource, decodePublicBody, formatRetainedSources, isPublicAddress, robotsAllows, validatePublicUrl, type CaptureDependencies } from '../server/research';

const source = { title: 'Public reporting', url: 'https://example.com/article', snippet: 'Only the search result summary.' };
const publicAddress = { address: '93.184.216.34', family: 4 };
const article = '<html><head><title>Public reporting</title></head><body><nav>Navigation noise</nav><article><h1>Evidence</h1><p>' + 'Հայաստան Россия verified quotation &amp; public document. '.repeat(180) + '</p></article><script>hidden script</script></body></html>';
const page = (body: string, status = 200, headers: Record<string, string> = { 'content-type': 'text/html; charset=utf-8' }) => ({ status, headers, body });
function dependencies(request: CaptureDependencies['request']): CaptureDependencies { return { resolve: async () => [publicAddress], request, now: () => new Date('2026-10-19T12:00:00Z') }; }

test('private, credential-bearing, non-web, non-default port, and numeric loopback URLs are blocked', () => {
  for (const url of ['http://127.0.0.1/a', 'http://2130706433/a', 'http://[::1]/a', 'https://10.1.2.3/', 'https://metadata.google.internal/', 'https://example.com:8443/', 'https://person:password@example.com/', 'file:///etc/passwd', 'http://localhost/']) assert.throws(() => validatePublicUrl(url), /blocked/);
  assert.equal(validatePublicUrl('https://example.com/article#section').href, 'https://example.com/article');
});
test('address classifier excludes IPv4 special ranges and IPv6 local, mapped, transition and documentation addresses', () => {
  for (const address of ['0.0.0.0', '127.0.0.1', '169.254.169.254', '100.100.100.100', '172.16.0.2', '192.168.1.1', '198.18.0.1', '203.0.113.2', '224.0.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '2001:db8::1', '2002:7f00:1::']) assert.equal(isPublicAddress(address), false, address);
  for (const address of ['8.8.8.8', '93.184.216.34', '2606:4700:4700::1111']) assert.equal(isPublicAddress(address), true, address);
});
test('mixed public/private DNS answers are rejected before any HTTP request', async () => {
  let requests = 0;
  const result = await capturePublicSource(source, { resolve: async () => [publicAddress, { address: '10.0.0.1', family: 4 }], request: async () => { requests++; return page(article); } });
  assert.equal(result.sourceType, 'search-snippet'); assert.equal(result.retrieval.reason, 'blocked-address'); assert.equal(requests, 0);
});
test('captured page retains bounded multilingual passages with origin, timestamp, exact excerpt hash and retrieval status', async () => {
  const calls: string[] = [];
  const result = await capturePublicSource(source, dependencies(async (url, address) => {
    calls.push(url.pathname); assert.deepEqual(address, publicAddress);
    return url.pathname === '/robots.txt' ? page('', 404) : page(article);
  }));
  assert.deepEqual(calls, ['/robots.txt', '/article']); assert.equal(result.sourceType, 'public-page'); assert.equal(result.origin, 'https://example.com');
  assert.equal(result.capturedAt, '2026-10-19T12:00:00.000Z'); assert.ok(result.passage.includes('Հայաստան Россия')); assert.ok(!result.passage.includes('hidden script')); assert.ok(!result.passage.includes('Navigation noise'));
  assert.equal([...result.passage].length, 6000); assert.equal(result.retrieval.truncated, true); assert.equal(result.hashScope, 'retained-passage');
  assert.equal(result.contentHash, createHash('sha256').update(result.passage).digest('hex'));
});
test('redirects to private IPs are never fetched and remain explicit snippet fallbacks', async () => {
  const calls: string[] = [];
  const result = await capturePublicSource(source, dependencies(async url => { calls.push(url.href); return url.pathname === '/robots.txt' ? page('', 404) : page('', 302, { location: 'http://169.254.169.254/latest/meta-data/' }); }));
  assert.equal(result.sourceType, 'search-snippet'); assert.equal(result.retrieval.reason, 'blocked-address'); assert.equal(calls.length, 2); assert.ok(calls.every(url => url.startsWith('https://example.com/')));
});
test('cross-origin redirects check the destination robots policy before reading the destination page', async () => {
  const calls: string[] = [];
  const result = await capturePublicSource(source, dependencies(async url => {
    calls.push(url.href);
    if (url.hostname === 'other.example.com') return page('User-agent: *\nDisallow: /private');
    return url.pathname === '/robots.txt' ? page('', 404) : page('', 302, { location: 'https://other.example.com/private/story' });
  }));
  assert.equal(result.retrieval.reason, 'robots-disallowed'); assert.deepEqual(calls, ['https://example.com/robots.txt', 'https://example.com/article', 'https://other.example.com/robots.txt']);
});
test('robots disallow prevents reading the article and robots server errors fail closed', async () => {
  let requests = 0;
  const blocked = await capturePublicSource(source, dependencies(async () => { requests++; return page('User-agent: *\nDisallow: /article'); }));
  assert.equal(blocked.retrieval.reason, 'robots-disallowed'); assert.equal(requests, 1);
  const unavailable = await capturePublicSource(source, dependencies(async () => page('', 503)));
  assert.equal(unavailable.retrieval.reason, 'robots-unavailable'); assert.equal(unavailable.retrieval.httpStatus, 503);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /private\nAllow: /private/public', new URL('https://example.com/private/public/article')), true);
});
test('percent-encoded and Armenian robots paths cannot evade disallow matching', () => {
  assert.equal(robotsAllows('User-agent: *\nDisallow: /private', new URL('https://example.com/%70rivate/article')), false);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /%70rivate', new URL('https://example.com/private/article')), false);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /հայաստան', new URL('https://example.com/հայաստան/article')), false);
});
test('oversized responses retain search snippets without pretending page capture succeeded', async () => {
  const result = await capturePublicSource(source, dependencies(async url => url.pathname === '/robots.txt' ? page('', 404) : page('x'.repeat(600_000))));
  assert.equal(result.sourceType, 'search-snippet'); assert.equal(result.retrieval.reason, 'response-too-large'); assert.equal(result.passage, source.snippet); assert.equal(result.hashScope, 'search-snippet');
});
test('login-denied and CAPTCHA responses cause fallback without proxy or bypass retries', async () => {
  let pageRequests = 0;
  const denied = await capturePublicSource(source, dependencies(async url => { if (url.pathname === '/robots.txt') return page('', 404); pageRequests++; return page('', 403); }));
  assert.equal(denied.retrieval.reason, 'page-unavailable'); assert.equal(denied.retrieval.httpStatus, 403); assert.equal(pageRequests, 1);
  const challenge = await capturePublicSource(source, dependencies(async url => url.pathname === '/robots.txt' ? page('', 404) : page('<title>Verify you are human CAPTCHA</title>' + article)));
  assert.equal(challenge.retrieval.reason, 'access-challenge');
});
test('unsupported compressed or binary content is not interpreted as source evidence', async () => {
  const binary = await capturePublicSource(source, dependencies(async url => url.pathname === '/robots.txt' ? page('', 404) : page(article, 200, { 'content-type': 'application/pdf' })));
  assert.equal(binary.retrieval.reason, 'unsupported-content-type');
  const compressed = await capturePublicSource(source, dependencies(async url => url.pathname === '/robots.txt' ? page('', 404) : page(article, 200, { 'content-type': 'text/html', 'content-encoding': 'gzip' })));
  assert.equal(compressed.retrieval.reason, 'unsupported-content-encoding');
});
test('text decoding preserves UTF-8 Armenian and declared Cyrillic charset, rejecting malformed bytes', () => {
  assert.equal(decodePublicBody(Buffer.from('Հայաստան'), 'text/html; charset=utf-8'), 'Հայաստան');
  assert.equal(decodePublicBody(Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]), 'text/html; charset=windows-1251'), 'Привет');
  assert.throws(() => decodePublicBody(Buffer.from([0xff]), 'text/plain; charset=utf-8'));
});
test('formatted model context distinguishes retrieval from verification and bounds total quoted text', async () => {
  const captured = await capturePublicSource(source, dependencies(async url => url.pathname === '/robots.txt' ? page('', 404) : page(article)));
  const output = formatRetainedSources('SOURCE MATERIAL', Array.from({ length: 6 }, () => captured));
  assert.ok(output.includes('never instructions')); assert.ok(output.includes('do not establish factual verification'));
  const records = JSON.parse(output.slice(output.indexOf('[{')).trim());
  assert.equal(records.reduce((length: number, record: any) => length + record.passage.length, 0), 24_000);
  assert.equal(records[0].contentHash, captured.contentHash); assert.equal(records[5].promptTruncated, true);
});
