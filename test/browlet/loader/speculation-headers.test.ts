import { createServer, type RequestListener } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InternalError } from '../../../src/infra/index';
import { serializeURL } from '../../../src/url/index';
import type { FetchRequest } from '../../../src/fetch/index';
import { FetchResponse } from '../../../src/fetch/index';
import * as fetchModule from '../../../src/fetch/fetch';
import { Browlet } from '../../../src/browlet/browlet';
import { BrowsingContext } from '../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable } from '../../../src/browlet/browsing/navigation/navigable';
import { DocumentState } from '../../../src/browlet/browsing/navigation/state/document-state';
import type { HTMLIFrameElementImpl } from '../../../src/browlet/dom/nodes/html/embedded/iframe';
import { CSPList, ContentSecurityPolicy } from '../../../src/browlet/browsing/policy/csp/index';
import { processSpeculationRulesHeader } from '../../../src/browlet/loader/speculation';
import { SpeculationRuleSet } from '../../../src/browlet/scripting/speculation-rules';
import { speculationRulesTaskSource } from '../../../src/browlet/scripting/tasks';
import { getRelevantRealm } from '../../support/browlet-binding';
import { closeServer, listen } from './http-fixture';

const cleanup: (() => Promise<void>)[] = [];
const deliveryErrors: unknown[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
  expect(deliveryErrors.splice(0)).toEqual([]);
});

// Real Fetch, bodies, CORS, and task delivery; only the explicit §7.6 parser boundary is controlled.
describe('Speculation-Rules response headers', () => {
  it.each([undefined, '', 'unquoted', '42, ?1, ("/inner")', '"/first", malformed garbage'])(
    'does not schedule absent, invalid, or non-string fields: %s', async (field) => {
      const { document, response } = await fixture();
      if (field !== undefined) response.headerList.append('Speculation-Rules', field);
      const parallel = vi.spyOn(document.env, 'runInParallel');
      processSpeculationRulesHeader(document, response);
      expect(parallel).not.toHaveBeenCalled();
    },
  );

  it('selects string items across repeated fields, ignores parameters, and preserves duplicates', async () => {
    const { document, response, origin, started, completed } = await fixture();
    const parse = vi.spyOn(SpeculationRuleSet, 'parse').mockImplementation(() => new SpeculationRuleSet());
    response.headerList.append('Speculation-Rules', '"/first";ignored=1, 42, token, ("/inner"), "http://[bad"');
    response.headerList.append('Speculation-Rules', '"/second", "/first"');
    processSpeculationRulesHeader(document, response);
    expect(started).toEqual([]);
    await expect.poll(() => completed.length).toBe(3);
    expect(started.map((request) => serializeURL(request.url))).toEqual([
      `${origin}/first`, `${origin}/second`, `${origin}/first`,
    ]);
    expect(parse).toHaveBeenCalledTimes(3);
    expect(document.speculationRuleSets).toHaveLength(3);
  });

  it('resolves even an empty item before parallel work and later base changes', async () => {
    const { document, response, origin, started, completed } = await fixture();
    vi.spyOn(SpeculationRuleSet, 'parse').mockImplementation(() => new SpeculationRuleSet());
    const base = document.createElement('base');
    base.setAttribute('href', '/original/');
    document.head!.appendChild(base);
    response.headerList.append('Speculation-Rules', '""');
    processSpeculationRulesHeader(document, response);
    base.setAttribute('href', '/changed/');
    await expect.poll(() => completed.length).toBe(1);
    expect(serializeURL(started[0]!.url)).toBe(`${origin}/original/`);
  });

  it.each([
    { status: 404, mime: 'application/speculationrules+json', parsed: false },
    { status: 204, mime: 'application/speculationrules+json', parsed: false },
    { status: 205, mime: 'application/speculationrules+json', parsed: false },
    { status: 200, mime: undefined, parsed: false },
    { status: 200, mime: 'text/plain', parsed: false },
    { status: 200, mime: 'application/json', parsed: false },
    { status: 200, mime: 'Application/SpeculationRules+JSON; charset=windows-1252', parsed: true },
  ])('checks status $status and MIME $mime before parsing', async ({ status, mime, parsed }) => {
    const { document, response, completed } = await fixture((_request, response) => {
      response.statusCode = status;
      if (mime !== undefined) response.setHeader('Content-Type', mime);
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.end('{}');
    });
    const parse = vi.spyOn(SpeculationRuleSet, 'parse').mockImplementation(() => new SpeculationRuleSet());
    const consider = vi.spyOn(document, 'considerSpeculativeLoads');
    response.headerList.append('Speculation-Rules', '"/rules"');
    processSpeculationRulesHeader(document, response);
    await expect.poll(() => completed.length).toBe(1);
    expect(parse).toHaveBeenCalledTimes(parsed ? 1 : 0);
    expect(consider).toHaveBeenCalledTimes(parsed ? 1 : 0);
  });

  it('ignores an interrupted body without registering rules', async () => {
    const { document, response, completed } = await fixture((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/speculationrules+json' });
      response.write('{');
      setImmediate(() => response.destroy());
    });
    const parse = vi.spyOn(SpeculationRuleSet, 'parse');
    response.headerList.append('Speculation-Rules', '"/broken"');
    processSpeculationRulesHeader(document, response);
    await expect.poll(() => completed.length).toBe(1);
    expect(parse).not.toHaveBeenCalled();
    expect(document.speculationRuleSets).toEqual([]);
  });

  it('decodes UTF-8 with BOM removal and replacement, and uses the final response URL as the rule base', async () => {
    const { document, response, origin, completed } = await fixture((request, response) => {
      if (request.url === '/start') {
        response.writeHead(302, { Location: '/redirected/rules' }).end();
      } else {
        response.writeHead(200, { 'Content-Type': 'application/speculationrules+json; charset=windows-1252' });
        response.end(Buffer.from([0xef, 0xbb, 0xbf, 0x22, 0xc3, 0xa9, 0xff, 0x22]));
      }
    });
    const rules = new SpeculationRuleSet();
    const parse = vi.spyOn(SpeculationRuleSet, 'parse').mockReturnValue(rules);
    const consider = vi.spyOn(document, 'considerSpeculativeLoads').mockImplementation(() => {
      expect(document.speculationRuleSets).toEqual([rules]);
    });
    response.headerList.append('Speculation-Rules', '"/start"');
    processSpeculationRulesHeader(document, response);
    await expect.poll(() => completed.length).toBe(1);
    expect(parse).toHaveBeenCalledExactlyOnceWith('"é�"', document, document.env.parseURL(`${origin}/redirected/rules`));
    expect(consider).toHaveBeenCalledOnce();
  });

  it('silently drops an author parse error and still registers other fetched rule sets', async () => {
    const { document, response, completed } = await fixture();
    const rules = new SpeculationRuleSet();
    vi.spyOn(SpeculationRuleSet, 'parse')
      .mockImplementationOnce(() => { throw new document.env.realm.TypeError('invalid rules'); })
      .mockReturnValue(rules);
    const report = vi.spyOn(document.env, 'reportException');
    response.headerList.append('Speculation-Rules', '"/invalid", "/valid"');
    processSpeculationRulesHeader(document, response);
    await expect.poll(() => completed.length).toBe(2);
    expect(document.speculationRuleSets).toEqual([rules]);
    expect(report).not.toHaveBeenCalled();
  });

  it('keeps the real parser dependency visible through asynchronous delivery', async () => {
    const { document, response, completed } = await fixture();
    response.headerList.append('Speculation-Rules', '"/rules"');
    processSpeculationRulesHeader(document, response);
    await expect.poll(() => completed.length).toBe(1);
    const error = deliveryErrors.shift();
    expect(error).toBeInstanceOf(InternalError);
    expect(error).toHaveProperty('message', 'Speculation rule set parsing is not implemented');
    expect(document.speculationRuleSets).toEqual([]);
  });

  it('uses the Document client, same-origin credentials, CORS, and the HTML CSP exemption', async () => {
    const received: { path: string; cookie?: string; origin?: string; destination?: string; }[] = [];
    const foreign = createServer((request, response) => {
      received.push({
        path: request.url!, cookie: request.headers.cookie, origin: request.headers.origin,
        destination: request.headers['sec-fetch-dest'],
      });
      response.setHeader('Content-Type', 'application/speculationrules+json');
      if (request.url === '/allowed') response.setHeader('Access-Control-Allow-Origin', '*');
      response.end('{}');
    });
    const foreignOrigin = await listen(foreign);
    cleanup.push(() => closeServer(foreign));
    const { document, response, origin, started, completed } = await fixture((request, response) => {
      received.push({
        path: request.url!, cookie: request.headers.cookie, origin: request.headers.origin,
        destination: request.headers['sec-fetch-dest'],
      });
      response.writeHead(200, { 'Content-Type': 'application/speculationrules+json' }).end('{}');
    });
    const { env } = document;
    const host = document.url.host;
    if (host?.kind !== 'ipv4') throw new Error('Expected the loopback fixture host');
    env.userAgent.cookieStore.parseAndStoreCookie('rules=1; Path=/', true, host, [''], true, false, true);
    document.policyContainer.cspList = new CSPList(document.origin);
    document.policyContainer.cspList.policies.push(ContentSecurityPolicy.parse(
      "default-src 'none'; script-src 'none'; connect-src 'none'", 'header', 'enforce',
    ));
    const parse = vi.spyOn(SpeculationRuleSet, 'parse').mockImplementation(() => new SpeculationRuleSet());
    response.headerList.append('Speculation-Rules', `"/same", "${foreignOrigin}/allowed", "${foreignOrigin}/denied"`);
    processSpeculationRulesHeader(document, response);
    await expect.poll(() => completed.length).toBe(3);
    expect(started.every((request) => request.client === env && request.env === env &&
      request.mode === 'cors' && request.credentialsMode === 'same-origin' && request.destination === 'speculationrules')).toBe(true);
    expect(received.find((request) => request.path === '/same')?.cookie).toBe('rules=1');
    for (const path of ['/allowed', '/denied']) {
      expect(received.find((request) => request.path === path)).toEqual({
        path,
        cookie: undefined, origin, destination: 'speculationrules',
      });
    }
    expect(parse).toHaveBeenCalledTimes(2);
    expect(document.speculationRuleSets).toHaveLength(2);
  });

  it('queues on the incoming Document and waits for its activation before fetching', async () => {
    const { document: previous, origin, started, completed } = await fixture();
    const navigable = previous.getNodeNavigable()!;
    const params = navigable.createNavigationParamsFromSource(previous.env.parseURL(`${origin}/incoming`)!);
    params.response.headerList.append('Speculation-Rules', '"/rules"');
    const document = navigable.createAndInitializeDocument('html', 'text/html', params);
    const parse = vi.spyOn(SpeculationRuleSet, 'parse').mockImplementation(() => new SpeculationRuleSet());
    const loop = document.env.realm.agent.eventLoop;
    await expect.poll(() => loop.getTaskQueue(speculationRulesTaskSource).size).toBe(1);
    expect(started).toEqual([]);
    expect(document.isFullyActive()).toBe(false);
    const entry = navigable.createHistoryEntry(document, params);
    navigable.currentSessionHistoryEntry = navigable.activeSessionHistoryEntry = entry;
    document.makeActive();
    await expect.poll(() => completed.length).toBe(1);
    expect(parse.mock.calls[0]![1]).toBe(document);
    expect(started[0]!.client).toBe(document.env);
    expect(previous.speculationRuleSets).toEqual([]);
  });

  it('ignores the header when creating a child Document', async () => {
    const { document: owner, origin } = await fixture();
    const parent = owner.getNodeNavigable()!;
    const container = owner.createElement('iframe') as HTMLIFrameElementImpl;
    const [, initial] = BrowsingContext.create(owner, container, parent.topLevelTraversable.activeBrowsingContext!.group!);
    // The automatic element lifecycle is unfinished; establish its retained child association explicitly.
    const child = new Navigable(DocumentState.create(initial), parent);
    container.contentNavigable = child;
    const params = child.createNavigationParamsFromSource(owner.env.parseURL(`${origin}/child`)!);
    params.response.headerList.append('Speculation-Rules', '"/rules"');
    const queue = vi.spyOn(owner.env.userAgent, 'runInParallel');
    const document = child.createAndInitializeDocument('html', 'text/html', params);
    expect(document.speculationRuleSets).toEqual([]);
    expect(queue).not.toHaveBeenCalled();
  });

  it('removes queued rule requests when their Document is destroyed', async () => {
    const { document, response, started } = await fixture();
    const { env } = document;
    const loop = env.responsibleEventLoop;
    // Advance the optional parallel delay inside the controlled destruction task.
    vi.spyOn(env, 'runInParallel').mockImplementation((steps) => steps());
    response.headerList.append('Speculation-Rules', '"/rules"');
    let destroyed = false;
    env.queueTask('dom-manipulation', {
      run: () => {
        processSpeculationRulesHeader(document, response);
        expect(loop.getTaskQueue(speculationRulesTaskSource).size).toBe(1);
        document.destroy();
        destroyed = true;
      },
    });
    await expect.poll(() => destroyed).toBe(true);
    expect(loop.getTaskQueue(speculationRulesTaskSource).size).toBe(0);
    expect(started).toEqual([]);
  });

  it('cancels an in-flight rule body through the Document fetch group on abortion', async () => {
    let received = false;
    const { document, response, completed } = await fixture((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/speculationrules+json' });
      response.write('{');
      received = true;
    });
    const parse = vi.spyOn(SpeculationRuleSet, 'parse');
    response.headerList.append('Speculation-Rules', '"/pending"');
    processSpeculationRulesHeader(document, response);
    await expect.poll(() => received).toBe(true);
    document.env.queueTask('dom-manipulation', { run: () => document.abort() });
    await expect.poll(() => completed.length).toBe(1);
    expect(parse).not.toHaveBeenCalled();
    expect(document.speculationRuleSets).toEqual([]);
  });
});

async function fixture(handler: RequestListener = (_request, response) => {
  response.writeHead(200, { 'Content-Type': 'application/speculationrules+json' }).end('{}');
}) {
  const server = createServer(handler);
  const origin = await listen(server);
  cleanup.push(() => closeServer(server));
  const browser = new Browlet({ route: () => '<!doctype html><html><head></head><body></body></html>' });
  await browser.navigate(`${origin}/page`);
  const env = getRelevantRealm(browser.window).env;
  cleanup.push(() => env.userAgent.httpTransport.close());
  const document = env.realm.getAssociatedDocument();
  const response = new FetchResponse();
  response.urlList = [document.url];
  const started: FetchRequest[] = [];
  const completed: FetchRequest[] = [];
  const realFetch = fetchModule.fetch;
  // Observe the real Fetch callback without replacing its response/body or task machinery.
  // Capture exceptions so a missing owner can be asserted without crashing the host task runner.
  vi.spyOn(fetchModule, 'fetch').mockImplementation((request, options, env) => {
    started.push(request);
    return realFetch(request, {
      ...options,
      processResponseConsumeBody(response, bytes) {
        try { options?.processResponseConsumeBody?.(response, bytes); }
        catch (error) { deliveryErrors.push(error); }
        finally { completed.push(request); }
      },
    }, env);
  });
  return { document, response, origin, started, completed };
}
