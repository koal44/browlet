import { beforeAll, describe, expect, it, vi } from 'vitest';

import { createSandboxEnvironment } from '../../../../src/browlet/bindings';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { createDocumentState } from '../../../../src/browlet/browsing/navigation/document-state';
import { Navigable, TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/navigable';
import { EmbedderPolicy, queueCOEPInheritanceViolation, type EmbedderPolicyValue } from '../../../../src/browlet/browsing/policy/coep';
import type { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/iframe';
import { BrowletEnvironmentBase } from '../../../../src/browlet/environment';
import type { Window } from '../../../../src/browlet/platform';
import { DedicatedWorkerGlobalScopeImpl } from '../../../../src/browlet/workers/dedicated-worker-global-scope';
import { WorkerGlobalScopeImpl } from '../../../../src/browlet/workers/worker-global-scope';
import { FetchResponse } from '../../../../src/fetch/response';
import { obtainURLOrigin, parseURL } from '../../../../src/url/url';
import { serializeURL } from '../../../../src/url/core/url';
import { createManualUserAgent } from '../../../support/browlet-agent';
import { getRelevantRealm, unwrap } from '../../../support/browlet-binding';

describe('cross-origin embedder policy headers', () => {
  let env: BrowletEnvironmentBase;
  beforeAll(() => {
    const owner = createOwner();
    const url = parseURL('https://owner.test/').url!;
    env = new BrowletEnvironmentBase({
      userAgent: owner.env.userAgent, creationURL: url, topLevelCreationURL: url,
      topLevelOrigin: obtainURLOrigin(url), targetBrowsingContext: owner.document.browsingContext, isSecureContext: true,
    });
  });

  describe.each(['Cross-Origin-Embedder-Policy', 'Cross-Origin-Embedder-Policy-Report-Only'])('%s', (header) => {
    const reportOnly = header.endsWith('Report-Only');
    it.each<[string | null, EmbedderPolicyValue, string]>([
      [null, 'unsafe-none', ''],
      ['require-corp', 'require-corp', ''],
      ['credentialless; report-to="reports"', 'credentialless', 'reports'],
      ['require-corp; report-to=""', 'require-corp', ''],
      ['require-corp; report-to=reports', 'require-corp', ''],
      ['require-corp; report-to=?1', 'require-corp', ''],
      ['require-corp; report-to="first"; report-to="last"', 'require-corp', 'last'],
      ['unsafe-none; report-to="reports"', 'unsafe-none', ''],
      ['unknown; report-to="reports"', 'unsafe-none', ''],
      ['Require-Corp', 'unsafe-none', ''],
      ['"require-corp"; report-to="reports"', 'unsafe-none', ''],
      ['require-corp, credentialless', 'unsafe-none', ''],
      ['(require-corp)', 'unsafe-none', ''],
      ['?1', 'unsafe-none', ''],
      ['require-corp;', 'unsafe-none', ''],
    ])('parses %j', (value, expectedValue, endpoint) => {
      const response = makeResponse();
      if (value !== null) response.headerList.append(header, value);
      const expected = new EmbedderPolicy();
      if (reportOnly) {
        expected.reportOnlyValue = expectedValue;
        expected.reportOnlyReportingEndpoint = endpoint;
      } else {
        expected.value = expectedValue;
        expected.reportingEndpoint = endpoint;
      }
      expect(EmbedderPolicy.obtain(response, env)).toEqual(expected);
    });

    it('rejects repeated fields combined into a list', () => {
      const response = makeResponse();
      response.headerList.append(header, 'require-corp');
      response.headerList.append(header, 'require-corp');
      expect(EmbedderPolicy.obtain(response, env)).toEqual(new EmbedderPolicy());
    });
  });

  it('parses the two dispositions independently and ignores both in a non-secure environment', () => {
    const response = makeResponse();
    response.headerList.append('Cross-Origin-Embedder-Policy', 'require-corp; report-to="enforced"');
    response.headerList.append('Cross-Origin-Embedder-Policy-Report-Only', 'credentialless; report-to="observed"');
    expect(EmbedderPolicy.obtain(response, env)).toEqual({
      value: 'require-corp', reportingEndpoint: 'enforced',
      reportOnlyValue: 'credentialless', reportOnlyReportingEndpoint: 'observed',
    });
    expect(EmbedderPolicy.obtain(response, new BrowletEnvironmentBase(null))).toEqual(new EmbedderPolicy());
  });
});

describe.each(['navigation', 'worker initialization'] as const)('COEP %s inheritance', (type) => {
  it.each<[EmbedderPolicyValue, EmbedderPolicyValue, EmbedderPolicyValue, boolean, string[]]>([
    ['unsafe-none', 'unsafe-none', 'unsafe-none', true, []],
    ['unsafe-none', 'require-corp', 'unsafe-none', true, ['reporting']],
    ['unsafe-none', 'credentialless', 'unsafe-none', true, ['reporting']],
    ['require-corp', 'unsafe-none', 'unsafe-none', false, ['enforce']],
    ['credentialless', 'unsafe-none', 'unsafe-none', false, ['enforce']],
    ['require-corp', 'credentialless', 'unsafe-none', false, ['reporting', 'enforce']],
    ['credentialless', 'require-corp', 'unsafe-none', false, ['reporting', 'enforce']],
    ['unsafe-none', 'require-corp', 'credentialless', true, []],
    ['unsafe-none', 'credentialless', 'require-corp', true, []],
    ['require-corp', 'require-corp', 'require-corp', true, []],
    ['credentialless', 'credentialless', 'credentialless', true, []],
    ['require-corp', 'require-corp', 'credentialless', true, []],
    ['credentialless', 'credentialless', 'require-corp', true, []],
  ])('owner %s / report-only %s with response %s', (value, reportOnlyValue, responseValue, allowed, dispositions) => {
    const owner = createOwner();
    const parentPolicy = owner.env.policyContainer.embedderPolicy;
    Object.assign(parentPolicy, { value, reportOnlyValue, reportingEndpoint: 'enforced', reportOnlyReportingEndpoint: 'observed' });
    const policy = new EmbedderPolicy();
    policy.value = responseValue;
    // A response's report-only policy cannot satisfy the owner's enforced requirement.
    policy.reportOnlyValue = 'require-corp';
    const response = makeResponse();
    if (type === 'navigation') {
      const { child } = createChild(owner);
      expect(child.checkResponseEmbedderPolicy(response, policy)).toBe(allowed);
    } else {
      const worker = new TestDedicatedWorker(createSandboxEnvironment());
      worker.embedderPolicy = policy;
      expect(worker.checkEmbedderPolicy(owner.env, response)).toBe(allowed);
    }
    expect(owner.scope.reports.map((report) => ({ endpoint: report.destination, body: report.data }))).toEqual(
      dispositions.map((disposition) => ({
        endpoint: disposition === 'reporting' ? 'observed' : 'enforced',
        body: { type, blockedURL: 'https://resource.test/initial', disposition },
      })),
    );
  });

  it.each([true, false])('preserves local reports with an empty endpoint and outbound delivery enabled: %s', (enabled) => {
    const owner = createOwner();
    owner.env.userAgent.reportDeliveryEnabled = enabled;
    const observer = new owner.window.ReportingObserver(() => {});
    observer.observe();
    const response = makeResponse();
    queueCOEPInheritanceViolation(response, type, '', 'enforce', owner.env);
    const reports = observer.takeRecords();
    expect(reports.map((report) => ({ type: report.type, url: report.url, body: report.body!.toJSON() }))).toEqual([{
      type: 'coep', url: 'about',
      body: { type, blockedURL: 'https://resource.test/initial', disposition: 'enforce' },
    }]);
    expect(owner.scope.reportBuffer).toHaveLength(1);
    expect(owner.scope.reports.map((report) => report.destination)).toEqual(enabled ? [''] : []);
    expect(response.urlList.map((url) => serializeURL(url))).toEqual([
      'https://user:secret@resource.test/initial#fragment', 'https://redirect.test/final',
    ]);
  });
});

describe('COEP navigation ownership', () => {
  it('does not check top-level navigation against its departing document', () => {
    const owner = createOwner();
    owner.env.policyContainer.embedderPolicy.value = 'require-corp';
    expect(owner.navigable.checkResponseEmbedderPolicy(makeResponse(), new EmbedderPolicy())).toBe(true);
    expect(owner.scope.reports).toEqual([]);
  });

  it('uses the embedding element\'s current node document after adoption', () => {
    const original = createOwner();
    const target = createOwner();
    const { child, container } = createChild(original);
    target.env.policyContainer.embedderPolicy.value = 'require-corp';
    target.env.policyContainer.embedderPolicy.reportingEndpoint = 'adopted';
    target.window.document.adoptNode(container);
    expect(child.containerDocument).toBe(target.document);
    expect(child.checkResponseEmbedderPolicy(makeResponse(), new EmbedderPolicy())).toBe(false);
    expect(original.scope.reports).toEqual([]);
    expect(target.scope.reports.map((report) => report.destination)).toEqual(['adopted']);
  });

  it('stops supplied-response document creation before committing a blocked child response', () => {
    const owner = createOwner();
    owner.env.policyContainer.embedderPolicy.value = 'require-corp';
    const { child } = createChild(owner);
    const document = child.activeDocument;
    const params = child.createNavigationParams(makeResponse());
    expect(() => child.createAndInitializeDocument('html', 'text/html', params))
      .toThrow('COEP-blocked navigation requires network-error processing');
    expect(child.activeDocument).toBe(document);
    expect(child.activeBrowsingContext!.activeDocument).toBe(document);
    expect(owner.scope.reports).toHaveLength(1);
  });
});

describe('COEP worker ownership', () => {
  it('exempts non-dedicated workers from the owner policy check', () => {
    const owner = createOwner();
    owner.env.policyContainer.embedderPolicy.value = 'require-corp';
    owner.env.policyContainer.embedderPolicy.reportOnlyValue = 'credentialless';
    const worker = new TestOtherWorker(createSandboxEnvironment());
    expect(worker.checkEmbedderPolicy(owner.env, makeResponse())).toBe(true);
    expect(owner.scope.reports).toEqual([]);
  });

  it('keeps default policy and scripting state separate for each worker', () => {
    const env = createSandboxEnvironment();
    const first = new TestDedicatedWorker(env);
    const second = new TestOtherWorker(env);
    first.embedderPolicy.value = 'require-corp';
    expect(second.embedderPolicy).toEqual(new EmbedderPolicy());
    expect(first.importMap).not.toBe(second.importMap);
    expect(first.resolvedModuleSet).not.toBe(second.resolvedModuleSet);
    expect(first.outstandingRejectedPromises).not.toBe(second.outstandingRejectedPromises);
    expect(first.aboutToBeNotifiedRejectedPromises).not.toBe(second.aboutToBeNotifiedRejectedPromises);
  });
});

function createOwner() {
  const navigable = TopLevelTraversable.create(createManualUserAgent(), null, '');
  const document = navigable.activeDocument!;
  const realm = getRelevantRealm(navigable.activeWindow!);
  return {
    navigable, document, env: realm.env, window: realm.globalObject as unknown as Window,
    scope: realm.windowImplementation.getWindowOrWorkerGlobalScopeMixin(),
  };
}

function createChild(owner: ReturnType<typeof createOwner>) {
  const [, document] = BrowsingContext.create(null, null, owner.navigable.activeBrowsingContext!.group!);
  const child = new Navigable(createDocumentState(document), owner.navigable);
  const container = owner.window.document.createElement('iframe');
  // Supply only the unfinished content-navigable association; documents and bindings are real.
  vi.spyOn(child, 'container', 'get').mockReturnValue(unwrap<HTMLIFrameElementImpl>(container));
  return { child, container };
}

function makeResponse(): FetchResponse {
  const response = new FetchResponse();
  response.urlList.push(
    parseURL('https://user:secret@resource.test/initial#fragment').url!,
    parseURL('https://redirect.test/final').url!,
  );
  return response;
}

// Exercise the partial implementation owners without pretending worker startup or projection exists.
class TestDedicatedWorker extends DedicatedWorkerGlobalScopeImpl {
  url = parseURL('https://worker.test/dedicated.js').url!;
}
class TestOtherWorker extends WorkerGlobalScopeImpl {
  url = parseURL('https://worker.test/other.js').url!;
}
