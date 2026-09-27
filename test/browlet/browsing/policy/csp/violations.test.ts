import { afterEach, describe, expect, it, vi } from 'vitest';
import { Browlet } from '../../../../../src/browlet/browlet';
import { getRelevantRealm, unwrap } from '../../../../../src/browlet/bindings';
import type { ElementImpl } from '../../../../../src/browlet/dom/nodes/element';
import { CSPList } from '../../../../../src/browlet/browsing/policy/csp/list';
import { ContentSecurityPolicy } from '../../../../../src/browlet/browsing/policy/csp/policy';
import { CSPViolation, CSPViolationReportBodyImpl } from '../../../../../src/browlet/browsing/policy/csp/violation';
import { ReportImpl } from '../../../../../src/browlet/reporting/report';
import * as fetchModule from '../../../../../src/fetch/index';
import { FetchRequest } from '../../../../../src/fetch/request';
import { FetchController } from '../../../../../src/fetch/controller';
import { parseURL, serializeURL } from '../../../../../src/url/url';
import { createCSPWindow } from './fixture';

afterEach(() => vi.restoreAllMocks());

describe('CSP violation construction and serialization', () => {
  it('captures protected resource metadata and the original request URL', () => {
    const { env, document, policy, request } = createCSPWindow("default-src 'none'");
    document.referrer = 'https://name:secret@referrer.test/path#fragment';
    request.destination = 'script';
    request.urlList.push(parseURL('https://redirected.test/private').url!);
    const violation = policy.createViolationForRequest(request);
    expect(violation.env).toBe(env);
    expect(violation.status).toBe(201);
    expect(violation.effectiveDirective).toBe('script-src-elem');
    expect(violation.blockedURI).toBe('https://resource.test/file');
    request.url.path = ['changed'];
    expect(violation.blockedURI).toBe('https://resource.test/file');
    const body = new CSPViolationReportBodyImpl(violation);
    expect(body.documentURL).toBe('https://protected.test/page');
    expect(body.referrer).toBe('https://referrer.test/path');
    expect(body.sourceFile).toBeNull();
    expect(body.lineNumber).toBeNull();
    expect(body.columnNumber).toBeNull();
    expect(serializeURL(document.url)).toBe('https://protected.test/page#section');
    expect(document.referrer).toContain('name:secret@');
  });

  it('serializes the legacy payload with conditional source-location fields', () => {
    const { policy, request } = createCSPWindow("img-src 'none'");
    const violation = policy.createViolationForRequest(request);
    const serialize = () => JSON.parse(new TextDecoder().decode(violation.serialize())) as { 'csp-report': Record<string, unknown>; };
    const original = serialize()['csp-report'];
    expect(original).toEqual({
      'document-uri': 'https://protected.test/page', referrer: '',
      'blocked-uri': 'https://resource.test/file', 'effective-directive': 'img-src',
      'violated-directive': 'img-src', 'original-policy': "img-src 'none'",
      disposition: 'enforce', 'status-code': 201, 'script-sample': '',
    });
    violation.sourceFile = parseURL('https://name:secret@source.test/main.js#position').url!;
    violation.lineNumber = 4;
    violation.columnNumber = 9;
    expect(serialize()['csp-report']).toMatchObject({
      'source-file': 'https://source.test/main.js', 'line-number': 4, 'column-number': 9,
    });
  });
});

describe('CSP violation delivery', () => {
  it('queues a trusted, bubbling, composed event before submitting its typed report', () => {
    const { window, request, runTask, scope } = createCSPWindow("img-src 'none'; report-to violations");
    const events: SecurityPolicyViolationEvent[] = [];
    window.document.addEventListener('securitypolicyviolation', (event) => {
      events.push(event);
      expect(scope.reports).toHaveLength(0);
    });
    expect(request.isBlockedByCSP()).toBe(true);
    expect(events).toHaveLength(0);
    expect(scope.reports).toHaveLength(0);
    expect(runTask()).toBe(true);
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event).toBeInstanceOf(window.SecurityPolicyViolationEvent);
    expect(event.isTrusted && event.bubbles && event.composed).toBe(true);
    expect(event.cancelable).toBe(false);
    expect(event.target).toBe(window.document);
    expect(event.documentURI).toBe('https://protected.test/page');
    expect(event.blockedURI).toBe('https://resource.test/file');
    expect(event.statusCode).toBe(201);
    expect(scope.reports).toHaveLength(1);
    expect(scope.reports[0]!.destination).toBe('violations');
    expect(scope.reports[0]!.body).toBeInstanceOf(CSPViolationReportBodyImpl);
  });

  it.each([false, true])('targets a connected element, falling back after removal=%s', (remove) => {
    const { env, window, policy, runTask } = createCSPWindow("script-src 'none'");
    const target = window.document.createElement('div');
    window.document.appendChild(target);
    const events: Event[] = [];
    window.document.addEventListener('securitypolicyviolation', (event) => events.push(event));
    const violation = new CSPViolation(policy, 'script-src-elem', 'inline', env);
    violation.element = unwrap<ElementImpl>(target);
    violation.report();
    if (remove) target.remove();
    runTask();
    expect(events).toHaveLength(1);
    expect(events[0]!.target).toBe(remove ? window.document : target);
  });

  it('reports each monitored policy without blocking and each enforced violation independently', () => {
    const { document, policy, request, runTask, scope } = createCSPWindow("img-src 'none'; report-to one", 'report');
    const monitored = ContentSecurityPolicy.parse("img-src 'none'; report-to two", 'header', 'report');
    document.policyContainer.cspList!.policies.push(monitored);
    request.policyContainer = document.policyContainer.clone();
    request.reportCSPViolations();
    expect(request.isBlockedByCSP()).toBe(false);
    while (runTask()) { /* Deliver queued reports. */ }
    expect(scope.reports.map((report) => report.destination)).toEqual(['one', 'two']);
    policy.disposition = 'enforce';
    monitored.disposition = 'enforce';
    request.policyContainer = document.policyContainer.clone();
    expect(request.isBlockedByCSP()).toBe(true);
    while (runTask()) { /* Deliver queued reports. */ }
    expect(scope.reports.map((report) => report.destination)).toEqual(['one', 'two', 'one', 'two']);
  });

  it('prepares legacy Fetch requests and ignores malformed endpoints', () => {
    const fetch = vi.spyOn(fetchModule, 'fetch').mockImplementation(() => new FetchController());
    const { env, request, runTask } = createCSPWindow("img-src 'none'; report-uri /reports http://[bad https://other.test/reports");
    request.isBlockedByCSP();
    runTask();
    expect(fetch).toHaveBeenCalledTimes(2);
    const report = fetch.mock.calls[0]![0];
    expect(report.client).toBe(env);
    expect(report.origin).toBe(env.origin);
    expect(serializeURL(report.url)).toBe('https://protected.test/reports');
    expect(report.method).toBe('POST');
    expect(report.traversableForUserPrompts).toBeNull();
    expect(report.destination).toBe('report');
    expect(report.mode).toBe('no-cors');
    expect(report.credentialsMode).toBe('same-origin');
    expect(report.keepalive).toBe(true);
    expect(report.redirectMode).toBe('error');
    expect(report.headerList.get('Content-Type')).toBe('application/csp-report');
    expect(JSON.parse(new TextDecoder().decode(report.body as Uint8Array))).toHaveProperty('csp-report');
  });

  it('lets report-to suppress report-uri even when the named endpoint is unconfigured', () => {
    const fetch = vi.spyOn(fetchModule, 'fetch').mockImplementation(() => new FetchController());
    const { request, runTask, scope } = createCSPWindow("img-src 'none'; report-uri /old; report-to new");
    request.isBlockedByCSP();
    runTask();
    expect(fetch).not.toHaveBeenCalled();
    expect(scope.reports[0]!.destination).toBe('new');
  });

  it.each(['report-uri /old', 'report-to new'])('keeps the event when outbound reporting is disabled: %s', (directive) => {
    const fetch = vi.spyOn(fetchModule, 'fetch').mockImplementation(() => new FetchController());
    const { env, window, request, runTask, scope } = createCSPWindow(`img-src 'none'; ${directive}`);
    env.userAgent.reportDeliveryEnabled = false;
    const event = vi.fn();
    window.document.addEventListener('securitypolicyviolation', event);
    request.isBlockedByCSP();
    runTask();
    expect(event).toHaveBeenCalledOnce();
    expect(scope.reports).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('delivers projected body fields and toJSON to a ReportingObserver on the running page loop', async () => {
    const browlet = new Browlet({ route: () => '', reporting: false });
    const env = getRelevantRealm(browlet.window).env;
    const policy = ContentSecurityPolicy.parse("img-src 'none'; report-to reports", 'header', 'enforce');
    env.policyContainer.cspList = new CSPList(env.origin);
    env.policyContainer.cspList.policies.push(policy);
    await browlet.exposeFunction('violate', () => {
      const request = new FetchRequest(parseURL('https://blocked.test/image').url!, env, env.userAgent);
      request.destination = 'image';
      request.populateFromClient();
      request.isBlockedByCSP();
    });
    const result = await browlet.evaluate(() => new Promise<object>((resolve) => {
      // lib.dom does not expose the ReportBody interfaces or their toJSON operation.
      const ReportBody = Reflect.get(globalThis, 'ReportBody') as new () => { toJSON(): object; };
      const CSPViolationReportBody = Reflect.get(globalThis, 'CSPViolationReportBody') as new () => object;
      const violate = Reflect.get(globalThis, 'violate') as () => Promise<void>;
      const observer = new ReportingObserver((reports) => {
        const report = reports[0]!;
        const body = report.body as InstanceType<typeof ReportBody>;
        resolve({
          type: report.type, derived: body instanceof CSPViolationReportBody,
          base: body instanceof ReportBody, fields: body.toJSON(),
          json: (JSON.parse(JSON.stringify(report)) as { body: object; }).body,
        });
      });
      observer.observe();
      void violate();
    }));
    const fields = {
      documentURL: 'about', referrer: null, blockedURL: 'https://blocked.test/image',
      effectiveDirective: 'img-src', originalPolicy: policy.serialized, sourceFile: null, sample: '',
      disposition: 'enforce', statusCode: 0, lineNumber: null, columnNumber: null,
    };
    expect(result).toEqual({ type: 'csp-violation', derived: true, base: true, fields, json: fields });
    const scope = env.getWindowOrWorkerGlobalScopeMixin();
    expect(scope.reports).toHaveLength(0);
    const report = scope.reportBuffer[0]!;
    const delivery = report.cloneForDelivery();
    expect(delivery.body).toBeNull();
    expect(delivery.data).not.toBe(report.data);
    const serialized = JSON.parse(new TextDecoder().decode(ReportImpl.serialize([delivery]))) as { body: unknown; }[];
    expect(serialized[0]!.body).toEqual(fields);
  });
});
