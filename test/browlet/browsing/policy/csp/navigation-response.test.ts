import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../../src/browlet/browlet';
import { BrowsingContext, Navigable } from '../../../../../src/browlet/browsing/navigation/index';
import { DocumentState } from '../../../../../src/browlet/browsing/navigation/state/index';
import { ContentSecurityPolicy, CSPList } from '../../../../../src/browlet/browsing/policy/csp/index';
import type { DocumentImpl } from '../../../../../src/browlet/dom/nodes/index';
import type { HTMLIFrameElementImpl } from '../../../../../src/browlet/dom/nodes/html/embedded/index';
import * as fetchModule from '../../../../../src/fetch/index';
import { FetchController, FetchRequest, FetchResponse } from '../../../../../src/fetch/index';
import { createOpaqueOrigin, obtainURLOrigin, parseURL, serializeURL } from '../../../../../src/url/index';
import { unwrap } from '../../../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('CSP frame-ancestors navigation-response checks', () => {
  it.each([
    ['', true],
    ["default-src 'none'", true],
    ["frame-src 'none'", true],
    ["form-action 'none'", true],
    ['frame-ancestors', false],
    ["frame-ancestors 'none'", false],
    ["frame-ancestors 'self'", true],
    ['frame-ancestors *', true],
    ['frame-ancestors https:', true],
    ['frame-ancestors https://example.test', true],
    ['frame-ancestors https://example.test/', true],
    ['frame-ancestors https://example.test:443', true],
    ['frame-ancestors https://example.test:8443', false],
    ['frame-ancestors https://elsewhere.test', false],
    ["frame-ancestors 'none' https://example.test", true],
    ['frame-ancestors https://example.test/parent', false],
    ['frame-ancestors https://example.test/parent/', false],
    ['frame-ancestors https://example.test; frame-ancestors', true],
  ])('policy %s admits an origin-matching child: %s', async (serialized, allowed) => {
    const { child, response, selfOrigin } = await fixture();
    const policy = ContentSecurityPolicy.parse(serialized, 'header', 'enforce');
    expect(policy.getViolatedNavigationResponseDirective(response, child, 'response', selfOrigin))
      .toBe(allowed ? undefined : 'frame-ancestors');
  });

  it.each(['enforce', 'report'] as const)('identifies a violation with disposition %s', async (disposition) => {
    const { child, response, selfOrigin } = await fixture();
    const policy = ContentSecurityPolicy.parse("frame-ancestors 'none'", 'header', disposition);
    expect(policy.getViolatedNavigationResponseDirective(response, child, 'response', selfOrigin)).toBe('frame-ancestors');
  });

  it('does not enforce the navigation source policy against its destination', async () => {
    const { child, response, selfOrigin } = await fixture();
    const policy = ContentSecurityPolicy.parse("frame-ancestors 'none'; form-action 'none'", 'header', 'enforce');
    expect(policy.getViolatedNavigationResponseDirective(response, child, 'source', selfOrigin)).toBeUndefined();
  });

  it('does not restrict top-level navigation', async () => {
    const { document, response, selfOrigin } = await fixture();
    const policy = ContentSecurityPolicy.parse("frame-ancestors 'none'", 'header', 'enforce');
    expect(policy.getViolatedNavigationResponseDirective(response, document.getNodeNavigable()!, 'response', selfOrigin))
      .toBeUndefined();
  });

  it.each(['about:blank', 'about:srcdoc', 'data:text/html,hello', 'blob:https://example.test/id'])('allows the local response %s', async (url) => {
    const { child, response, selfOrigin } = await fixture();
    response.urlList = [parseURL(url).url!];
    const policy = ContentSecurityPolicy.parse("frame-ancestors 'none'", 'header', 'enforce');
    expect(policy.getViolatedNavigationResponseDirective(response, child, 'response', selfOrigin)).toBeUndefined();
  });

  it('does not treat a file response as a Fetch local URL', async () => {
    const { child, response, selfOrigin } = await fixture();
    response.urlList = [parseURL('file:///document.html').url!];
    const policy = ContentSecurityPolicy.parse("frame-ancestors 'none'", 'header', 'enforce');
    expect(policy.getViolatedNavigationResponseDirective(response, child, 'response', selfOrigin)).toBe('frame-ancestors');
  });

  it.each(['*', 'https:', "'self'"])('blocks an opaque ancestor with %s', async (source) => {
    const { document, child, response, selfOrigin } = await fixture();
    document.origin = createOpaqueOrigin();
    const policy = ContentSecurityPolicy.parse(`frame-ancestors ${source}`, 'header', 'enforce');
    expect(policy.getViolatedNavigationResponseDirective(response, child, 'response', selfOrigin)).toBe('frame-ancestors');
  });

  it.each(['top', 'intermediate', 'none'])('checks every ancestor with a foreign %s', async (foreign) => {
    const { document, childDocument, response, selfOrigin } = await fixture();
    const { child } = createChild(childDocument);
    if (foreign !== 'none') {
      (foreign === 'top' ? document : childDocument).origin = obtainURLOrigin(parseURL('https://elsewhere.test/').url!);
    }
    const policy = ContentSecurityPolicy.parse("frame-ancestors 'self'", 'header', 'enforce');
    expect(policy.getViolatedNavigationResponseDirective(response, child, 'response', selfOrigin))
      .toBe(foreign === 'none' ? undefined : 'frame-ancestors');
  });

  it('uses ancestor origins rather than about:blank Document URLs', async () => {
    const { childDocument, response, selfOrigin } = await fixture();
    const { child } = createChild(childDocument);
    expect(childDocument.URL).toBe('about:blank');
    const policy = ContentSecurityPolicy.parse("frame-ancestors 'self'", 'header', 'enforce');
    expect(policy.getViolatedNavigationResponseDirective(response, child, 'response', selfOrigin)).toBeUndefined();
  });

  it('retains the policy self origin independently of the response and departing child origins', async () => {
    const { child, childDocument, response, selfOrigin } = await fixture();
    response.urlList = [parseURL('https://response.test/next').url!];
    childDocument.origin = createOpaqueOrigin();
    const policy = ContentSecurityPolicy.parse("frame-ancestors 'self'", 'header', 'enforce');
    expect(policy.getViolatedNavigationResponseDirective(response, child, 'response', selfOrigin)).toBeUndefined();
  });

  it('uses response-policy self origin even when destination sandboxing selects an opaque Document origin', async () => {
    const { child, response } = await fixture();
    response.headerList.append('Content-Security-Policy', "frame-ancestors 'self'");
    const snapshot = child.snapshotTargetParams();
    snapshot.sandboxingFlags.add('sandboxed-origin');
    const params = child.createNavigationParams(response, snapshot);
    expect(params.origin.kind).toBe('opaque');
    const list = params.policyContainer.cspList!;
    expect(list.policies[0]!.getViolatedNavigationResponseDirective(response, child, 'response', list.selfOrigin)).toBeUndefined();
  });

  it.each(['example.test', 'sub.example.test'])('ignores document.domain when the original host is %s', async (host) => {
    const { document, child, response, selfOrigin } = await fixture();
    const origin = obtainURLOrigin(parseURL(`https://${host}/parent`).url!);
    if (origin.kind !== 'tuple') throw new Error('Expected a tuple origin');
    origin.domain = { kind: 'domain', value: 'example.test' };
    document.origin = origin;
    const policy = ContentSecurityPolicy.parse("frame-ancestors 'self'", 'header', 'enforce');
    expect(policy.getViolatedNavigationResponseDirective(response, child, 'response', selfOrigin))
      .toBe(host === 'example.test' ? undefined : 'frame-ancestors');
  });

  it('uses the current container Document after adoption', async () => {
    const first = await fixture();
    const second = await fixture();
    second.document.origin = createOpaqueOrigin();
    second.document.adoptNode(first.iframe);
    const policy = ContentSecurityPolicy.parse('frame-ancestors *', 'header', 'enforce');
    expect(policy.getViolatedNavigationResponseDirective(first.response, first.child, 'response', first.selfOrigin)).toBe('frame-ancestors');
  });

  it('requires populated response and child-container inputs', async () => {
    const { child, iframe, response, selfOrigin } = await fixture();
    const policy = ContentSecurityPolicy.parse('frame-ancestors *', 'header', 'enforce');
    expect(() => policy.getViolatedNavigationResponseDirective(new FetchResponse(), child, 'response', selfOrigin))
      .toThrow('CSP navigation-response checks require a response URL');
    iframe.contentNavigable = null;
    expect(() => policy.getViolatedNavigationResponseDirective(response, child, 'response', selfOrigin))
      .toThrow('Frame-ancestors checking requires a container Document');
  });
});

describe('CSP navigation-response policy aggregation', () => {
  it.each([
    ['enforce', true], ['report', false],
  ] as const)('reports a %s violation and blocks: %s', async (disposition, blocked) => {
    const { document, child, response, tasks, fetch } = await reportingFixture();
    const list = new CSPList(obtainURLOrigin(response.url!));
    list.policies.push(ContentSecurityPolicy.parse("frame-ancestors 'none'; report-uri /report", 'header', disposition));
    response.status = 403;

    expect(list.isNavigationResponseBlocked(null, response, 'other', child, document.env.userAgent)).toBe(blocked);
    expect(tasks).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
    tasks.shift()!();
    expect(fetch).toHaveBeenCalledOnce();
    const request = fetch.mock.calls[0]![0];
    expect(request.client).toBeNull();
    expect(serializeURL(request.url)).toBe('https://example.test/report');
    expect(request.body).toBeInstanceOf(Uint8Array);
    expect(JSON.parse(new TextDecoder().decode(request.body as Uint8Array))).toMatchObject({
      'csp-report': {
        'document-uri': 'https://example.test/next', 'blocked-uri': 'https://example.test/next',
        'effective-directive': 'frame-ancestors', 'status-code': 403, disposition,
      },
    });
  });

  it('reports every violation after an enforcing policy blocks, without reporting matching policies', async () => {
    const { document, child, response, tasks, fetch } = await reportingFixture();
    response.headerList.append('Content-Security-Policy', "frame-ancestors 'none'; report-uri /first");
    response.headerList.append('Content-Security-Policy', "frame-ancestors 'self'; report-uri /allowed");
    response.headerList.append('Content-Security-Policy', 'frame-ancestors https://elsewhere.test; report-uri /second');
    response.headerList.append('Content-Security-Policy-Report-Only', "frame-ancestors 'none'; report-uri /monitored");

    expect(CSPList.parse(response).isNavigationResponseBlocked(null, response, 'other', child, document.env.userAgent)).toBe(true);
    expect(tasks).toHaveLength(3);
    for (const task of tasks) task();
    expect(fetch.mock.calls.map(([request]) => serializeURL(request.url))).toEqual([
      'https://example.test/first', 'https://example.test/second', 'https://example.test/monitored',
    ]);
  });

  it.each(['form-submission', 'other'] as const)('does not apply source policies as response restrictions for %s', async (type) => {
    const { document, child, response, tasks } = await reportingFixture();
    const request = new FetchRequest(response.url!, document.env);
    request.client = document.env;
    request.policyContainer = document.policyContainer.clone();
    const sourceList = new CSPList(document.origin);
    sourceList.policies.push(ContentSecurityPolicy.parse(
      "frame-ancestors 'none'; form-action 'none'; frame-src 'none'; default-src 'none'; report-uri /source", 'header', 'enforce',
    ));
    request.policyContainer.cspList = sourceList;

    expect(CSPList.parse(response).isNavigationResponseBlocked(request, response, type, child, document.env.userAgent)).toBe(false);
    expect(tasks).toHaveLength(0);
  });

  it('uses the retained response list self origin rather than reparsing the response headers', async () => {
    const { document, child, response, tasks } = await reportingFixture();
    const list = new CSPList(document.origin);
    list.policies.push(ContentSecurityPolicy.parse("frame-ancestors 'self'; report-uri /retained", 'header', 'enforce'));
    response.urlList = [parseURL('https://incoming.test/page').url!];
    response.headerList.append('Content-Security-Policy', "frame-ancestors 'none'; report-uri /unselected");

    expect(list.isNavigationResponseBlocked(null, response, 'other', child, document.env.userAgent)).toBe(false);
    expect(tasks).toHaveLength(0);
  });

  it('does not borrow parent or departing Document policies when the request is null', async () => {
    const { document, childDocument, child, response, tasks } = await reportingFixture();
    for (const source of [document, childDocument]) {
      const list = new CSPList(source.origin);
      list.policies.push(ContentSecurityPolicy.parse("frame-ancestors 'none'; report-uri /existing", 'header', 'enforce'));
      source.policyContainer.cspList = list;
    }

    expect(CSPList.parse(response).isNavigationResponseBlocked(null, response, 'other', child, document.env.userAgent)).toBe(false);
    expect(tasks).toHaveLength(0);
  });

  it.each(['about:blank', 'about:srcdoc', 'data:text/html,hello', 'blob:https://example.test/id'])(
    'allows a null-request local response %s with inherited frame-ancestors', async (url) => {
      const { document, child, response, tasks } = await reportingFixture();
      const list = new CSPList(document.origin);
      list.policies.push(ContentSecurityPolicy.parse("frame-ancestors 'none'; report-uri /inherited", 'header', 'enforce'));
      response.urlList = [parseURL(url).url!];

      expect(list.isNavigationResponseBlocked(null, response, 'other', child, document.env.userAgent)).toBe(false);
      expect(tasks).toHaveLength(0);
    },
  );

  it('does not report frame-ancestor restrictions for a top-level navigation', async () => {
    const { document, response, tasks } = await reportingFixture();
    response.headerList.append('Content-Security-Policy', "frame-ancestors 'none'; report-uri /report");
    expect(CSPList.parse(response).isNavigationResponseBlocked(
      null, response, 'other', document.getNodeNavigable()!, document.env.userAgent,
    )).toBe(false);
    expect(tasks).toHaveLength(0);
  });
});

async function fixture() {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate('https://example.test/parent');
  const document = unwrap<DocumentImpl>(browser.document);
  const response = new FetchResponse();
  response.urlList.push(parseURL('https://example.test/next').url!);
  return { document, response, selfOrigin: obtainURLOrigin(response.url!), ...createChild(document) };
}

async function reportingFixture() {
  const values = await fixture();
  const tasks: (() => void)[] = [];
  vi.spyOn(values.document.env.userAgent, 'queueReportingTask').mockImplementation((steps) => { tasks.push(steps); });
  const fetch = vi.spyOn(fetchModule, 'fetch').mockImplementation(() => new FetchController());
  return { ...values, tasks, fetch };
}

function createChild(document: DocumentImpl) {
  const navigable = document.getNodeNavigable()!;
  const iframe = document.createElement('iframe') as HTMLIFrameElementImpl;
  const group = document.browsingContext!.topLevelBrowsingContext!.group!;
  const [, childDocument] = BrowsingContext.create(document, iframe, group);
  const child = new Navigable(DocumentState.create(childDocument), navigable);
  iframe.contentNavigable = child;
  document.body!.appendChild(iframe);
  return { child, childDocument, iframe };
}
