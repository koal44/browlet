import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createSecureServer, type Http2ServerRequest, type Http2ServerResponse } from 'node:http2';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getBindingContext, getRelevantRealm, project } from '../../src/browlet/bindings';
import { Browlet } from '../../src/browlet/browlet';
import type { AuthenticationPrompt } from '../../src/browlet/loader/authentication';
import { NodeHTTPTransport } from '../../src/browlet/loader/node-transport';
import { UserAgent } from '../../src/browlet/user-agent';
import { FetchBody } from '../../src/fetch/body';
import type { AuthenticationCredentials } from '../../src/fetch/environment';
import { FetchRequest } from '../../src/fetch/request';
import type { FetchResponse } from '../../src/fetch/response';
import { ResponseImpl } from '../../src/fetch/response';
import { toScalarValueString } from '../../src/infra/strings';
import { parseBasicURL } from '../../src/url/url';
import { FormDataImpl } from '../../src/xhr/form-data';
import { closeServer, listen } from './loader/http-fixture';
import { createFetchOperation } from './fetch-fixture';

const basic = 'Basic dTpw'; // u:p
const credentials = { username: 'u', password: 'p' };
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});

describe('HTTP authentication cache', () => {
  it('reuses a credential in the authenticated directory and its descendants', () => {
    const store = new UserAgent().httpAuthentication;
    const entry = { ...credentials, realm: 'private' };
    store.store(url('https://example.test/docs/index'), entry, store.generation);
    for (const path of ['/docs/', '/docs/other', '/docs/deep/item', '/docs/?query', '/docs/item#fragment']) {
      expect(store.find(url('https://example.test' + path))).toBe(entry);
    }
    for (const path of ['/', '/docs', '/docs-other/item', '/Docs/item', '/other/']) {
      expect(store.find(url('https://example.test' + path))).toBeNull();
    }
  });

  it('keeps schemes, hosts, and ports separate, with canonical default ports', () => {
    const store = new UserAgent().httpAuthentication;
    const entry = { ...credentials, realm: 'private' };
    store.store(url('https://example.test:443/docs/'), entry, store.generation);
    expect(store.find(url('https://EXAMPLE.test/docs/'))).toBe(entry);
    for (const target of ['http://example.test/docs/', 'https://example.test:444/docs/', 'https://other.test/docs/']) {
      expect(store.find(url(target))).toBeNull();
      expect(store.find(url(target), 'private')).toBeNull();
    }
  });

  it('matches exact realm labels after a challenge without guessing the path', () => {
    const store = new UserAgent().httpAuthentication;
    const first = { ...credentials, realm: 'Private' };
    const second = { username: 'other', password: 'secret', realm: 'private' };
    store.store(url('https://example.test/a/item'), first, store.generation);
    store.store(url('https://example.test/b/item'), second, store.generation);
    expect(store.find(url('https://example.test/a/next'))).toBe(first);
    expect(store.find(url('https://example.test/b/next'))).toBe(second);
    expect(store.find(url('https://example.test/unknown/'), 'Private')).toBe(first);
    expect(store.find(url('https://example.test/unknown/'), 'private')).toBe(second);
    expect(store.find(url('https://example.test/unknown/'), 'PRIVATE')).toBeNull();
  });

  it('retains multiple authenticated directories when replacing credentials in one realm', () => {
    const store = new UserAgent().httpAuthentication;
    const first = { ...credentials, realm: 'private' };
    const second = { ...first, password: 'replacement' };
    store.store(url('https://example.test/a/item'), first, store.generation);
    store.store(url('https://example.test/b/item'), second, store.generation);
    expect(store.find(url('https://example.test/a/next'))).toBe(second);
    expect(store.find(url('https://example.test/b/next'))).toBe(second);
    expect(store.find(url('https://example.test/c/next'))).toBeNull();
  });

  it('prefers the closest authenticated directory over a more recent ancestor', () => {
    const store = new UserAgent().httpAuthentication;
    const reports = { ...credentials, realm: 'reports' };
    const admin = { ...credentials, realm: 'admin' };
    const root = { ...credentials, realm: 'root' };
    store.store(url('https://example.test/admin/reports/item'), reports, store.generation);
    store.store(url('https://example.test/admin/item'), admin, store.generation);
    store.store(url('https://example.test/item'), root, store.generation);
    expect(store.find(url('https://example.test/admin/reports/next'))).toBe(reports);
    expect(store.find(url('https://example.test/admin/next'))).toBe(admin);
    expect(store.find(url('https://example.test/next'))).toBe(root);
  });

  it('uses the most recently authenticated entry on directory ties, including replacements', () => {
    const store = new UserAgent().httpAuthentication;
    const target = url('https://example.test/docs/item');
    const first = { ...credentials, realm: 'first' };
    const second = { ...credentials, realm: 'second' };
    const replacement = { ...first, password: 'replacement' };
    store.store(target, first, store.generation);
    store.store(target, second, store.generation);
    expect(store.find(target)).toBe(second);
    store.store(target, replacement, store.generation);
    expect(store.find(target, 'second')).toBe(second);
    expect(store.find(target)).toBe(replacement);
  });

  it.each([['/', '/admin/reports/'], ['/admin/reports/', '/']])('retains nested scope preferences when learning %s then %s', (firstPath, secondPath) => {
    const store = new UserAgent().httpAuthentication;
    const first = { ...credentials, realm: 'first' };
    const second = { ...credentials, realm: 'second' };
    store.store(url('https://example.test' + firstPath), first, store.generation);
    store.store(url('https://example.test' + secondPath), first, store.generation);
    store.store(url('https://example.test/admin/item'), second, store.generation);
    expect(store.find(url('https://example.test/admin/reports/next'))).toBe(first);
    expect(store.find(url('https://example.test/admin/next'))).toBe(second);
  });

  it('does not mistake an encoded slash for a directory boundary', () => {
    const store = new UserAgent().httpAuthentication;
    const entry = { ...credentials, realm: 'private' };
    store.store(url('https://example.test/a%2Fb/item'), entry, store.generation);
    expect(store.find(url('https://example.test/a%2Fb/next'))).toBe(entry);
    expect(store.find(url('https://example.test/a/b/next'))).toBeNull();
  });

  it('ignores rejection of an entry already replaced by another exchange', () => {
    const store = new UserAgent().httpAuthentication;
    const target = url('https://example.test/private/item');
    const oldEntry = { ...credentials, realm: 'private' };
    const newEntry = { ...oldEntry, password: 'new' };
    store.store(target, oldEntry, store.generation);
    store.store(target, newEntry, store.generation);
    store.invalidate(target, oldEntry);
    expect(store.find(target)).toBe(newEntry);
    store.invalidate(target, newEntry);
    expect(store.find(target)).toBeNull();
  });

  it('does not restore cleared credentials from an earlier exchange', () => {
    const store = new UserAgent().httpAuthentication;
    const target = url('https://example.test/private/item');
    const entry = { ...credentials, realm: 'private' };
    const generation = store.generation;
    store.store(target, entry, generation);
    store.clear();
    store.store(target, entry, generation);
    expect(store.find(target)).toBeNull();
    store.store(target, entry, store.generation);
    expect(store.find(target)).toBe(entry);
  });
});

describe('HTTP authentication transactions', () => {
  it.each([false, true])('retains the challenge through a successful response and reuses the credentials (HTTP/2: %s)', async (http2) => {
    const f = await fixture(undefined, http2);
    const prompt = vi.fn<AuthenticationPrompt>(() => credentials);
    f.store.onPrompt = prompt;
    const operation = f.operation();
    expect(await f.text(await operation.start())).toBe('accepted');
    expect(f.seen.map((request) => request.authorization)).toEqual([undefined, basic]);
    expect(f.store.find(operation.request.currentURL)?.realm).toBe('private');
    expect(operation.request.headerList.has('Authorization')).toBe(false);
    expect(prompt).toHaveBeenCalledOnce();
    expect(prompt.mock.calls[0]![0]).toMatchObject({
      url: f.origin + '/private/item', realm: 'private', username: null, previousFailed: false,
    });
    expect(prompt.mock.calls[0]![0].target).toBe(operation.request.traversableForUserPrompts);
    expect(await f.text(await f.operation('/private/next').start())).toBe('accepted');
    expect(f.seen).toHaveLength(3);
    expect(prompt).toHaveBeenCalledOnce();
  });

  it('uses a known realm after an out-of-scope challenge without a second prompt', async () => {
    const f = await fixture();
    const prompt = vi.fn<AuthenticationPrompt>(() => credentials);
    f.store.onPrompt = prompt;
    await f.text(await f.operation().start());
    await f.text(await f.operation('/other/item').start());
    expect(f.seen.map((request) => request.authorization)).toEqual([undefined, basic, undefined, basic]);
    expect(f.store.find(url(f.origin + '/other/next'))?.realm).toBe('private');
    expect(prompt).toHaveBeenCalledOnce();
  });

  it.each(['omit', 'same-origin', 'no-prompt', 'cors-taint'] as const)('obeys the %s credential or prompt gate', async (gate) => {
    const f = await fixture();
    f.store.store(url(f.origin + '/private/item'), { ...credentials, realm: 'private' }, f.store.generation);
    const prompt = vi.fn<AuthenticationPrompt>(() => credentials);
    f.store.onPrompt = prompt;
    const operation = f.operation();
    if (gate === 'omit') operation.request.credentialsMode = 'omit';
    if (gate === 'same-origin') operation.request.responseTainting = 'cors'; operation.request.mode = 'cors';
    if (gate === 'no-prompt' || gate === 'cors-taint') {
      f.store.clear();
      if (gate === 'no-prompt') { operation.request.traversableForUserPrompts = null; }
      else { operation.request.credentialsMode = 'include'; operation.request.responseTainting = 'cors'; operation.request.mode = 'cors'; }
    }
    const response = await operation.start();
    expect(response.status).toBe(401);
    expect(await f.text(response)).toBe('challenge');
    expect(f.seen.map((request) => request.authorization)).toEqual([undefined]);
    expect(prompt).not.toHaveBeenCalled();
  });

  it('sends cached credentials with include mode even when a new prompt is prohibited', async () => {
    const f = await fixture();
    f.store.store(url(f.origin + '/private/item'), { ...credentials, realm: 'private' }, f.store.generation);
    const operation = f.operation();
    operation.request.credentialsMode = 'include';
    operation.request.responseTainting = 'cors'; operation.request.mode = 'cors';
    operation.request.traversableForUserPrompts = null;
    expect(await f.text(await operation.start())).toBe('accepted');
    expect(f.seen.map((request) => request.authorization)).toEqual([basic]);
  });

  it('selects a valid Basic challenge from repeated fields and preserves decomposed credentials', async () => {
    const value = 'Basic ZcyBOmXMgQ==';
    const f = await fixture((request, response) => {
      if (request.headers.authorization === value) { response.end('accepted'); return; }
      response.statusCode = 401;
      response.setHeader('WWW-Authenticate', ['Digest realm="other", qop="auth,auth-int"', 'Basic realm="private", charset=UTF-8']);
      response.end('challenge');
    });
    f.store.onPrompt = () => ({ username: 'e\u0301', password: 'e\u0301' });
    expect(await f.text(await f.operation().start())).toBe('accepted');
    expect(f.seen.map((request) => request.authorization)).toEqual([undefined, value]);
  });

  it.each([
    undefined, 'Bearer opaque', 'Basic', 'Basic realm="x", REALM="x"', 'Basic realm="unterminated',
  ])('leaves an unusable challenge available without prompting (%s)', async (challenge) => {
    const f = await fixture((_request, response) => {
      response.statusCode = 401;
      if (challenge !== undefined) response.setHeader('WWW-Authenticate', challenge);
      response.end('challenge');
    });
    const prompt = vi.fn<AuthenticationPrompt>(() => credentials);
    f.store.onPrompt = prompt;
    const response = await f.operation().start();
    expect(response.status).toBe(401);
    expect(await f.text(response)).toBe('challenge');
    expect(prompt).not.toHaveBeenCalled();
    expect(f.seen).toHaveLength(1);
  });

  it('replaces rejected cached credentials and prefills the username', async () => {
    const f = await fixture();
    f.store.store(url(f.origin + '/private/item'), { username: 'old', password: 'wrong', realm: 'private' }, f.store.generation);
    const prompt = vi.fn<AuthenticationPrompt>(() => credentials);
    f.store.onPrompt = prompt;
    expect(await f.text(await f.operation().start())).toBe('accepted');
    expect(prompt.mock.calls[0]![0]).toMatchObject({ username: 'old', previousFailed: true });
    expect(f.store.find(url(f.origin + '/private/item'))).toMatchObject(credentials);
  });

  it('removes rejected cached credentials even when prompting is suppressed', async () => {
    const f = await fixture();
    f.store.store(url(f.origin + '/private/item'), { username: 'wrong', password: 'wrong', realm: 'private' }, f.store.generation);
    const operation = f.operation();
    operation.request.traversableForUserPrompts = null;
    const response = await operation.start();
    expect(response.status).toBe(401);
    await f.text(response);
    expect(f.store.find(operation.request.currentURL)).toBeNull();
  });

  it('uses URL credentials only after a challenge and decodes their percent-encoded bytes', async () => {
    const value = 'Basic w6k6cDpx'; // é:p:q
    const f = await fixture((request, response) => {
      if (request.headers.authorization === value) { response.end('accepted'); return; }
      response.statusCode = 401;
      response.setHeader('WWW-Authenticate', 'Basic realm="private"');
      response.end('challenge');
    });
    const prompt = vi.fn<AuthenticationPrompt>(() => null);
    f.store.onPrompt = prompt;
    const operation = f.operation('/private/item');
    operation.request.currentURL.username = '%C3%A9';
    operation.request.currentURL.password = 'p%3Aq';
    operation.request.useURLCredentials = true;
    expect(await f.text(await operation.start())).toBe('accepted');
    expect(f.seen.map((request) => request.authorization)).toEqual([undefined, value]);
    expect(f.store.find(operation.request.currentURL)).toEqual({ username: 'é', password: 'p:q', realm: 'private' });
    expect(prompt).not.toHaveBeenCalled();
  });

  it.each([false, true])('uses the URL-credential preference flag (%s)', async (preferURL) => {
    const f = await fixture();
    const target = url(f.origin + '/private/item');
    f.store.store(target, { ...credentials, realm: 'private' }, f.store.generation);
    const operation = f.operation();
    operation.request.currentURL.username = 'u';
    operation.request.currentURL.password = 'p';
    operation.request.useURLCredentials = preferURL;
    expect(await f.text(await operation.start())).toBe('accepted');
    expect(f.seen.map((request) => request.authorization)).toEqual(preferURL ? [undefined, basic] : [basic]);
  });

  it('preserves an author-supplied Authorization header', async () => {
    const f = await fixture((request, response) => { response.end(request.headers.authorization!); });
    f.store.store(url(f.origin + '/private/item'), { ...credentials, realm: 'private' }, f.store.generation);
    const operation = f.operation();
    operation.request.headerList.set('Authorization', 'Bearer author');
    expect(await f.text(await operation.start())).toBe('Bearer author');
    expect(operation.request.headerList.get('Authorization')).toBe('Bearer author');
  });

  it('returns an authored Authorization challenge without prompting or retrying', async () => {
    const f = await fixture();
    const prompt = vi.fn<AuthenticationPrompt>(() => credentials);
    f.store.onPrompt = prompt;
    const operation = f.operation();
    operation.request.headerList.set('Authorization', 'Bearer rejected');
    const response = await operation.start();
    expect(response.status).toBe(401);
    expect(await f.text(response)).toBe('challenge');
    expect(prompt).not.toHaveBeenCalled();
    expect(f.seen).toHaveLength(1);
  });

  it('allows a fresh prompt to retry credentials rejected by the same challenge', async () => {
    let authenticatedAttempts = 0;
    const f = await fixture((request, response) => {
      if (request.headers.authorization === basic && ++authenticatedAttempts === 2) {
        response.end('accepted');
        return;
      }
      response.statusCode = 401;
      response.setHeader('WWW-Authenticate', 'Basic realm="private"');
      response.end('challenge');
    });
    const prompt = vi.fn<AuthenticationPrompt>(() => credentials);
    f.store.onPrompt = prompt;
    expect(await f.text(await f.operation().start())).toBe('accepted');
    expect(prompt.mock.calls.map(([challenge]) => challenge.previousFailed)).toEqual([false, true]);
    expect(f.seen.map((request) => request.authorization)).toEqual([undefined, basic, basic]);
    expect(f.store.find(url(f.origin + '/private/item'))).toEqual({ ...credentials, realm: 'private' });
  });

  it('lets the host decline after a failed attempt and leaves the 401 body readable', async () => {
    const f = await fixture((_request, response) => {
      response.statusCode = 401;
      response.setHeader('WWW-Authenticate', 'Basic realm="private"');
      response.end('challenge');
    });
    const prompt = vi.fn<AuthenticationPrompt>(() => null).mockReturnValueOnce(credentials);
    f.store.onPrompt = prompt;
    const response = await f.operation().start();
    expect(response.status).toBe(401);
    expect(await f.text(response)).toBe('challenge');
    expect(prompt).toHaveBeenCalledTimes(2);
    expect(prompt.mock.calls.map(([challenge]) => challenge.previousFailed)).toEqual([false, true]);
    expect(f.seen).toHaveLength(2);
    expect(f.store.find(url(f.origin + '/private/item'))).toBeNull();
  });

  it('does not automatically retry rejected credentials restored by another exchange', async () => {
    const replacement = { ...credentials, realm: 'private' };
    const f = await fixture((_request, response) => {
      if (f.seen.length > 1) { response.end('unexpected automatic retry'); return; }
      f.store.store(url(f.origin + '/private/item'), replacement, f.store.generation);
      response.statusCode = 401;
      response.setHeader('WWW-Authenticate', 'Basic realm="private"');
      response.end('challenge');
    });
    f.store.store(url(f.origin + '/private/item'), { ...replacement }, f.store.generation);
    const prompt = vi.fn<AuthenticationPrompt>(() => null);
    f.store.onPrompt = prompt;
    const response = await f.operation().start();
    expect(response.status).toBe(401);
    expect(await f.text(response)).toBe('challenge');
    expect(prompt).toHaveBeenCalledOnce();
    expect(prompt.mock.calls[0]![0].previousFailed).toBe(true);
    expect(f.seen).toHaveLength(1);
    expect(f.store.find(url(f.origin + '/private/item'))).toBe(replacement);
  });

  it('can reuse identical cached credentials when the server changes realms', async () => {
    const f = await fixture((_request, response) => {
      if (f.seen.length === 3) { response.end('accepted'); return; }
      response.statusCode = 401;
      response.setHeader('WWW-Authenticate', f.seen.length === 1 ? 'Basic realm="private"' : 'Basic realm="other"');
      response.end('challenge');
    });
    f.store.store(url(f.origin + '/elsewhere/item'), { ...credentials, realm: 'other' }, f.store.generation);
    const prompt = vi.fn<AuthenticationPrompt>(() => null).mockReturnValueOnce(credentials);
    f.store.onPrompt = prompt;
    expect(await f.text(await f.operation().start())).toBe('accepted');
    expect(prompt).toHaveBeenCalledOnce();
    expect(f.seen.map((request) => request.authorization)).toEqual([undefined, basic, basic]);
  });

  it('does not label a challenge for a different realm as a failed prompt attempt', async () => {
    const f = await fixture((_request, response) => {
      if (f.seen.length === 2) { response.end('accepted'); return; }
      response.statusCode = 401;
      response.setHeader('WWW-Authenticate', 'Basic realm="other"');
      response.end('challenge');
    });
    const previous = { ...credentials, realm: 'private' };
    const target = url(f.origin + '/private/item');
    f.store.store(target, previous, f.store.generation);
    const prompt = vi.fn<AuthenticationPrompt>(() => credentials);
    f.store.onPrompt = prompt;
    expect(await f.text(await f.operation().start())).toBe('accepted');
    expect(prompt).toHaveBeenCalledOnce();
    expect(prompt.mock.calls[0]![0]).toMatchObject({ realm: 'other', previousFailed: false });
    expect(f.store.find(target, 'private')).toBe(previous);
  });

  it('replays identical multipart bytes after authentication and a subsequent 421', async () => {
    let authenticatedAttempts = 0;
    const f = await fixture((request, response) => {
      if (!request.headers.authorization) {
        response.statusCode = 401;
        response.setHeader('WWW-Authenticate', 'Basic realm="private"');
      } else {
        response.statusCode = ++authenticatedAttempts === 1 ? 421 : 200;
      }
      response.end('result');
    });
    const form = new FormDataImpl(undefined, null, f.env);
    form.append(toScalarValueString('field'), toScalarValueString('captured'));
    const extracted = FetchBody.extract(form, false, f.env);
    const operation = f.operation();
    operation.request.method = 'POST';
    operation.request.body = extracted.body;
    operation.request.headerList.set('Content-Type', extracted.type!);
    f.store.onPrompt = () => {
      form.set(toScalarValueString('field'), toScalarValueString('changed later'));
      return credentials;
    };
    expect(await f.text(await operation.start())).toBe('result');
    expect(f.seen.map((request) => request.authorization)).toEqual([undefined, basic, basic]);
    expect(f.seen.map((request) => request.body)).toEqual(Array(3).fill(f.seen[0]!.body));
    expect(f.seen[0]!.body.toString()).toContain('captured');
    expect(f.seen[0]!.body.toString()).not.toContain('changed later');
    expect(f.seen.map((request) => request.contentType)).toEqual(Array(3).fill(extracted.type));
    expect(f.store.find(operation.request.currentURL)?.realm).toBe('private');
  });

  it('rejects an authentication retry for a body without a replay source', async () => {
    const f = await fixture(undefined, true);
    const operation = f.operation();
    operation.request.method = 'POST';
    operation.request.body = FetchBody.fromBytes(Uint8Array.of(1, 2), f.env);
    operation.request.body.source = null;
    const prompt = vi.fn<AuthenticationPrompt>(() => credentials);
    f.store.onPrompt = prompt;
    expect((await operation.start()).type).toBe('error');
    expect(prompt).not.toHaveBeenCalled();
    expect(f.seen).toHaveLength(1);
  });
});

describe('Authentication prompt lifetime', () => {
  it('declines by default and leaves the challenge body readable', async () => {
    const f = await fixture();
    const response = await f.operation().start();
    expect(response.status).toBe(401);
    expect(await f.text(response)).toBe('challenge');
    expect(f.seen).toHaveLength(1);
  });

  it('settles cancellation without waiting for the host and ignores a late answer', async () => {
    const f = await fixture();
    const shown = Promise.withResolvers<AbortSignal>();
    const answer = Promise.withResolvers<AuthenticationCredentials | null>();
    f.store.onPrompt = ({ signal }) => { shown.resolve(signal); return answer.promise; };
    const operation = f.operation();
    const response = operation.start();
    const signal = await shown.promise;
    operation.controller.abort(f.env);
    expect((await response).type).toBe('error');
    expect(signal.aborted).toBe(true);
    answer.resolve(credentials);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(f.seen).toHaveLength(1);
    expect(f.store.find(operation.request.currentURL)).toBeNull();
    expect(operation.request.currentURL.username).toBe('');
  });

  it('does not restore credentials when the browser clears them during a prompt', async () => {
    const f = await fixture();
    const shown = Promise.withResolvers<void>();
    const answer = Promise.withResolvers<AuthenticationCredentials | null>();
    f.store.onPrompt = () => { shown.resolve(); return answer.promise; };
    const operation = f.operation();
    const pending = operation.start();
    await shown.promise;
    f.browlet.clearHTTPCredentials();
    answer.resolve(credentials);
    const response = await pending;
    expect(response.status).toBe(401);
    await f.text(response);
    expect(f.seen).toHaveLength(1);
    expect(f.store.find(operation.request.currentURL)).toBeNull();
  });

  it('does not restore credentials when clearing occurs during the authenticated request', async () => {
    const accepted = Promise.withResolvers<ServerResponse | Http2ServerResponse>();
    const f = await fixture((request, response) => {
      if (request.headers.authorization) { accepted.resolve(response); return; }
      response.statusCode = 401;
      response.setHeader('WWW-Authenticate', 'Basic realm="private"');
      response.end('challenge');
    });
    f.store.onPrompt = () => credentials;
    const operation = f.operation();
    const pending = operation.start();
    const serverResponse = await accepted.promise;
    f.browlet.clearHTTPCredentials();
    serverResponse.end('accepted');
    expect(await f.text(await pending)).toBe('accepted');
    expect(f.store.find(operation.request.currentURL)).toBeNull();
  });

  it('turns a rejected host prompt into a network error without retaining credentials', async () => {
    const f = await fixture();
    f.store.onPrompt = () => Promise.reject(new Error('host prompt failed'));
    const operation = f.operation();
    expect((await operation.start()).type).toBe('error');
    expect(f.store.find(operation.request.currentURL)).toBeNull();
    expect(f.seen).toHaveLength(1);
  });
});

async function fixture(handle: (request: IncomingMessage | Http2ServerRequest, response: ServerResponse | Http2ServerResponse) => void = (request, response) => {
  if (request.headers.authorization === basic) { response.end('accepted'); return; }
  response.statusCode = 401;
  response.setHeader('WWW-Authenticate', 'Basic realm="private"');
  response.end('challenge');
}, http2 = false) {
  const seen: { path: string; authorization: string | undefined; contentType: string | undefined; body: Buffer; }[] = [];
  const cert = http2 ? readFileSync('test/browlet/loader/fixtures/localhost-cert.pem') : undefined;
  const server = http2
    ? createSecureServer({ cert, key: readFileSync('test/browlet/loader/fixtures/localhost-key.pem') })
    : createServer();
  server.on('request', (request: IncomingMessage | Http2ServerRequest, response: ServerResponse | Http2ServerResponse) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      seen.push({
        path: request.url!, authorization: request.headers.authorization,
        contentType: request.headers['content-type'], body: Buffer.concat(chunks),
      });
      if (request.headers.origin) {
        response.setHeader('Access-Control-Allow-Origin', request.headers.origin);
        response.setHeader('Access-Control-Allow-Credentials', 'true');
      }
      handle(request, response);
    });
  });
  const origin = (await listen(server, http2 ? 'https' : 'http')).replace('127.0.0.1', 'localhost');
  cleanup.push(() => closeServer(server));
  const browlet = new Browlet({ route: () => '', reporting: false });
  await browlet.navigate(origin);
  const realm = getRelevantRealm(browlet.window);
  const env = realm.env;
  if (http2) env.userAgent.httpTransport = new NodeHTTPTransport(env.userAgent, cert);
  cleanup.push(() => env.userAgent.httpTransport.close());
  const operation = (path = '/private/item') => {
    const request = new FetchRequest(env.parseURL(origin + path).url!, env, env.userAgent);
    request.populateFromClient();
    request.referrer = null;
    return createFetchOperation(request, env);
  };
  const text = (response: FetchResponse) => {
    const context = getBindingContext(realm);
    Reflect.set(browlet.window, 'networkResponse', project(context.construct(ResponseImpl, response, 'response')));
    return browlet.evaluate(async () => (globalThis as unknown as { networkResponse: Response; }).networkResponse.text());
  };
  return { browlet, env, origin, seen, operation, text, store: env.userAgent.httpAuthentication };
}

function url(value: string) { return parseBasicURL(value).url!; }
