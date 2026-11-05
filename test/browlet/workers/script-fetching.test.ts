import { afterEach, describe, expect, it, vi } from 'vitest';

import { utf8Encode } from '../../../src/encoding/index';
import { FetchHeaders, type HTTPTransportListener, type RequestCredentials } from '../../../src/fetch/index';
import { parseURL, serializeURL } from '../../../src/url/index';
import { Browlet } from '../../../src/browlet/browlet';
import { ContentSecurityPolicy, CSPList } from '../../../src/browlet/browsing/policy/csp/index';
import type { BrowletEnvironment, WorkerEnvironment } from '../../../src/browlet/environment/index';
import { createWorkerEnvironment } from '../../../src/browlet/integration/web-idl/index';
import { DedicatedWorkerAgent, SharedWorkerAgent, type ClassicScript, type ModuleScript } from '../../../src/browlet/scripting/index';
import type { WorkerType } from '../../../src/browlet/workers/index';
import { mockHTTPTransport } from '../../fetch/transport-fixture';
import { getRelevantRealm } from '../../support/browlet-binding';

afterEach(() => vi.restoreAllMocks());

// Real worker realms, Fetch, policies, parsing, and module graph loading. Only
// HTTP I/O is replaced. This does not start an isolate or run the returned script.
describe('Worker script response initialization (HTML §10.2.4)', () => {
  it.each(['classic', 'module'] as const)('installs the redirected %s response before parsing without executing it', async (type) => {
    const outsideEnv = await createOutsideEnvironment();
    const env = createWorker(outsideEnv, type);
    const initialOrigin = env.origin;
    const transport = mockHTTPTransport(outsideEnv.userAgent, (request, listener) => {
      expect(request.headers.get('Sec-Fetch-Dest')).toBe('worker');
      if (serializeURL(request.url).endsWith('/worker.js')) {
        listener.onHeaders(302, '', new FetchHeaders([['Location', '/final.js']]), true);
        listener.onEnd();
      } else {
        respond(listener, 'globalThis.scriptRan = true;', {
          'Content-Security-Policy': "script-src 'self'; upgrade-insecure-requests",
          'Referrer-Policy': 'no-referrer',
          'Cross-Origin-Embedder-Policy': 'require-corp',
        });
      }
    });

    const script = await load(env, outsideEnv);

    expect(transport).toHaveBeenCalledTimes(2);
    expect(script?.env).toBe(env);
    expect(script?.errorToRethrow).toBeNull();
    expect(serializeURL(script!.baseURL!)).toBe('https://modules.test/final.js');
    expect(serializeURL(env.apiBaseURL)).toBe('https://modules.test/final.js');
    expect(env.creationURL).toBe(env.globalImplementation.url);
    expect(env.globalImplementation.location.href).toBe('https://modules.test/final.js');
    expect(env.policyContainer.referrerPolicy).toBe('no-referrer');
    expect(env.globalImplementation.embedderPolicy.value).toBe('require-corp');
    expect(env.insecureRequestsPolicy.upgrade).toBe(true);
    expect(outsideEnv.insecureRequestsPolicy.upgrade).toBe(false);
    expect(env.origin).toBe(initialOrigin);
    expect(env.executionReady).toBe(false);
    expect(env.global).not.toHaveProperty('scriptRan');
  });

  it.each(['', 'allow-scripts', 'allow-same-origin'])('rejects an enforced sandbox missing a required permission: %s', async (tokens) => {
    const outsideEnv = await createOutsideEnvironment();
    const env = createWorker(outsideEnv);
    mockHTTPTransport(outsideEnv.userAgent, (_request, listener) => {
      respond(listener, 'globalThis.scriptRan = true;', { 'Content-Security-Policy': `sandbox ${tokens}` });
    });
    expect(await load(env, outsideEnv)).toBeNull();
    expect(env.executionReady).toBe(false);
    // Failure cleanup is the processing-model caller's next step.
    expect(env.discarded).toBe(false);
  });

  it.each(['Content-Security-Policy', 'Content-Security-Policy-Report-Only'])('accepts an unrestricted sandbox via %s', async (header) => {
    const outsideEnv = await createOutsideEnvironment();
    const env = createWorker(outsideEnv);
    mockHTTPTransport(outsideEnv.userAgent, (_request, listener) => {
      respond(listener, '', { [header]: header.endsWith('Report-Only') ? 'sandbox; upgrade-insecure-requests' : 'sandbox allow-scripts allow-same-origin' });
    });
    expect((await load(env, outsideEnv))?.errorToRethrow).toBeNull();
    expect(env.insecureRequestsPolicy.upgrade).toBe(false);
  });

  it('applies every enforced policy, even after an earlier sandbox blocks startup', async () => {
    const outsideEnv = await createOutsideEnvironment();
    const env = createWorker(outsideEnv);
    mockHTTPTransport(outsideEnv.userAgent, (_request, listener) => {
      respond(listener, '', { 'Content-Security-Policy': 'sandbox, upgrade-insecure-requests' });
    });
    expect(await load(env, outsideEnv)).toBeNull();
    expect(env.insecureRequestsPolicy.upgrade).toBe(true);
  });

  it('inherits local policies but ignores a sandbox delivered through meta', async () => {
    const outsideEnv = await createOutsideEnvironment();
    outsideEnv.policyContainer.cspList = new CSPList(outsideEnv.origin);
    outsideEnv.policyContainer.cspList.policies.push(ContentSecurityPolicy.parse('sandbox', 'meta', 'enforce'));
    const env = createWorker(outsideEnv, 'classic', false, 'data:text/javascript,');
    expect((await load(env, outsideEnv))?.errorToRethrow).toBeNull();
    expect(env.policyContainer).not.toBe(outsideEnv.policyContainer);
    expect(env.policyContainer.cspList).toEqual(outsideEnv.policyContainer.cspList);
  });

  it('rejects an incompatible dedicated worker and reports through the creator', async () => {
    const outsideEnv = await createOutsideEnvironment();
    outsideEnv.policyContainer.embedderPolicy.value = 'require-corp';
    outsideEnv.policyContainer.embedderPolicy.reportingEndpoint = 'coep-endpoint';
    const report = vi.spyOn(outsideEnv, 'queueReport');
    const env = createWorker(outsideEnv);
    mockHTTPTransport(outsideEnv.userAgent, (_request, listener) => respond(listener));
    expect(await load(env, outsideEnv)).toBeNull();
    expect(report).toHaveBeenCalledWith('coep', 'coep-endpoint', {
      type: 'worker initialization', blockedURL: 'https://modules.test/worker.js', disposition: 'enforce',
    });
  });

  it('retains the response URL for COEP reporting when CSP has already rejected it', async () => {
    const outsideEnv = await createOutsideEnvironment();
    outsideEnv.policyContainer.embedderPolicy.value = 'require-corp';
    const report = vi.spyOn(outsideEnv, 'queueReport');
    const env = createWorker(outsideEnv);
    mockHTTPTransport(outsideEnv.userAgent, (_request, listener) => respond(listener, '', { 'Content-Security-Policy': 'sandbox' }));
    expect(await load(env, outsideEnv)).toBeNull();
    expect(report).toHaveBeenCalledWith('coep', '', expect.objectContaining({ blockedURL: 'https://modules.test/worker.js' }));
  });

  it('selects logical isolation for a shared worker without granting concrete capability', async () => {
    const outsideEnv = await createOutsideEnvironment();
    const env = createWorker(outsideEnv, 'classic', true);
    mockHTTPTransport(outsideEnv.userAgent, (request, listener) => {
      expect(request.headers.get('Sec-Fetch-Dest')).toBe('sharedworker');
      respond(listener, '', { 'Cross-Origin-Embedder-Policy': 'credentialless' });
    });
    expect((await load(env, outsideEnv))?.errorToRethrow).toBeNull();
    expect(env.realm.agent.agentCluster!.crossOriginIsolationMode).toBe('logical');
    expect(env.crossOriginIsolatedCapability).toBe(false);
  });

  it.each([
    [true, 'https://modules.test/child.js', true],
    [false, 'https://modules.test/child.js', false],
    [true, 'data:text/javascript,', false],
  ] as const)('propagates concrete capability from owner %s to %s as %s', async (ownerIsolated, url, expected) => {
    const parent = createWorker(await createOutsideEnvironment());
    // Supply the processing model's inputs, without claiming native isolation.
    parent.realm.agent.agentCluster!.crossOriginIsolationMode = 'concrete';
    parent.globalImplementation.crossOriginIsolatedCapability = ownerIsolated;
    parent.policyContainer.embedderPolicy.value = 'require-corp';
    const env = createWorker(parent, 'classic', false, url);
    mockHTTPTransport(parent.userAgent, (_request, listener) => respond(listener, '', { 'Cross-Origin-Embedder-Policy': 'require-corp' }));
    expect((await load(env, parent))?.errorToRethrow).toBeNull();
    expect(env.crossOriginIsolatedCapability).toBe(expected);
  });

  it.each(['network', 'mime', 'status'] as const)('retains %s failures as failed script loads', async (failure) => {
    const outsideEnv = await createOutsideEnvironment();
    const env = createWorker(outsideEnv);
    const originalURL = env.creationURL;
    mockHTTPTransport(outsideEnv.userAgent, (_request, listener) => {
      if (failure === 'network') {
        listener.onError(new Error('unavailable'));
      }
      else {
        listener.onHeaders(failure === 'status' ? 404 : 200, '', new FetchHeaders([['Content-Type', 'text/plain']]), true);
        listener.onData(utf8Encode('not javascript'));
        listener.onEnd();
      }
    });
    expect(await load(env, outsideEnv)).toBeNull();
    expect(env.executionReady).toBe(false);
    if (failure === 'network') expect(env.creationURL).toBe(originalURL);
  });

  it('loads module descendants without replacing the root policies and preserves module credentials', async () => {
    const outsideEnv = await createOutsideEnvironment();
    const env = createWorker(outsideEnv, 'module');
    const transport = mockHTTPTransport(outsideEnv.userAgent, (request, listener) => {
      expect(request.includeCredentials).toBe(false);
      if (serializeURL(request.url).endsWith('/worker.js')) {
        respond(listener, "import './dep.js';", { 'Referrer-Policy': 'no-referrer', 'Cross-Origin-Embedder-Policy': 'require-corp' });
      } else {
        respond(listener, 'export const answer = 42;', { 'Referrer-Policy': 'unsafe-url', 'Content-Security-Policy': 'sandbox' });
      }
    });
    expect((await load(env, outsideEnv, 'omit'))?.errorToRethrow).toBeNull();
    expect(transport).toHaveBeenCalledTimes(2);
    expect(env.policyContainer.referrerPolicy).toBe('no-referrer');
    expect(env.globalImplementation.embedderPolicy.value).toBe('require-corp');
    expect(serializeURL(env.creationURL)).toBe('https://modules.test/worker.js');
    expect(env.moduleMap.get(parseURL('https://modules.test/dep.js').url!, 'javascript-or-wasm')).toBeDefined();
  });
});

function load(env: WorkerEnvironment, outsideEnv: BrowletEnvironment, credentials: RequestCredentials = 'include') {
  return new Promise<ClassicScript | ModuleScript | null>((complete) => env.fetchScript(outsideEnv, credentials, complete));
}

async function createOutsideEnvironment() {
  const browser = new Browlet({ route: () => '', reporting: false });
  await browser.navigate('https://modules.test/page');
  return getRelevantRealm(browser.window).env;
}

function createWorker(outsideEnv: BrowletEnvironment, type: WorkerType = 'classic', shared = false, url = 'https://modules.test/worker.js') {
  const agent = outsideEnv.userAgent.obtainDedicatedOrSharedWorkerAgent(outsideEnv, shared);
  if (!(agent instanceof DedicatedWorkerAgent || agent instanceof SharedWorkerAgent)) throw new Error('Expected worker agent');
  return createWorkerEnvironment({
    agent, outsideEnv, url: parseURL(url).url!, unsafeWorkerCreationTime: 1234,
    type, name: 'fetch test', credentials: 'include', extendedLifetime: false,
  });
}

function respond(listener: HTTPTransportListener, source = '', headers: Record<string, string> = {}) {
  listener.onHeaders(200, '', new FetchHeaders(Object.entries({ 'Content-Type': 'text/javascript', ...headers })), true);
  listener.onData(utf8Encode(source));
  listener.onEnd();
}
