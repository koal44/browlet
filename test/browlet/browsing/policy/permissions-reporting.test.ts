import { describe, expect, it } from 'vitest';

import { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/navigable';
import type { PermissionsPolicyViolationReportBody } from '../../../../src/browlet/browsing/policy/permissions-policy-report';
import type { Report } from '../../../../src/browlet/platform';
import { ReportImpl } from '../../../../src/browlet/reporting/report';
import { utf8Decode } from '../../../../src/encoding/index';
import { createManualUserAgent } from '../../../support/browlet-agent';
import { getRelevantRealm } from '../../../support/browlet-binding';

const violationType = 'permissions-policy-violation';
const potentialType = 'potential-permissions-policy-violation';

describe('Permissions Policy §8: report body and shared Reporting integration', () => {
  it('exposes the specified derived interface without an author constructor or writable attributes', () => {
    const { window, env, realm } = createWindow();
    expect(typeof window.PermissionsPolicyViolationReportBody).toBe('function');
    expect(() => {
      // @ts-expect-error The interface has no author constructor.
      new window.PermissionsPolicyViolationReportBody();
    }).toThrow(realm.TypeError);
    const observer = new window.ReportingObserver(() => {});
    observer.observe();
    env.queueReport(violationType, 'policy', violation());
    const report = observer.takeRecords()[0]!;
    const body = report.body!;
    expect(body).toBeInstanceOf(window.ReportBody);
    expect(body).toBeInstanceOf(window.PermissionsPolicyViolationReportBody);
    expect(Object.getPrototypeOf(body)).toBe(window.PermissionsPolicyViolationReportBody.prototype);
    expect(Object.prototype.toString.call(body)).toBe('[object PermissionsPolicyViolationReportBody]');
    expect(report.body).toBe(body);
    for (const name of ['featureId', 'sourceFile', 'lineNumber', 'columnNumber', 'disposition', 'allowAttribute', 'srcAttribute']) {
      expect(Reflect.set(body, name, 'replacement')).toBe(false);
      const descriptor = Object.getOwnPropertyDescriptor(window.PermissionsPolicyViolationReportBody.prototype, name)!;
      expect(descriptor.set === undefined).toBe(true);
      expect(() => { descriptor.get!.call({}); }).toThrow(realm.TypeError);
    }
    expect(() => body.toJSON.call({})).toThrow(realm.TypeError);
    expect(Reflect.has(body, 'message')).toBe(false);
  });

  it('projects absent iframe fields as null while retaining their omission in outbound payloads', () => {
    const { window, env, realm, scope } = createWindow();
    const observer = new window.ReportingObserver(() => {});
    observer.observe();
    const data = violation();
    env.queueReport(violationType, 'policy', data);
    const report = observer.takeRecords()[0]!;
    const json = report.body!.toJSON();
    expect(json).toEqual({ ...data, allowAttribute: null, srcAttribute: null });
    expect(Object.getPrototypeOf(json)).toBe(realm.Object.prototype);
    expect(report.body!.toJSON()).not.toBe(json);
    expect(JSON.parse(JSON.stringify(report))).toEqual({
      type: violationType, url: report.url, body: { ...data, allowAttribute: null, srcAttribute: null },
    });
    const outbound = scope.reports[0]!.cloneForDelivery();
    expect(outbound.body).toBeNull();
    expect(outbound.data).toEqual(data);
    const serialized = JSON.parse(utf8Decode(ReportImpl.serialize([outbound]))) as Array<{ body: object; }>;
    expect(serialized[0]!.body).toEqual(data);
    expect(Object.hasOwn(serialized[0]!.body, 'allowAttribute')).toBe(false);
    expect(Object.hasOwn(serialized[0]!.body, 'srcAttribute')).toBe(false);
  });

  it.each([
    { allowAttribute: 'cross-origin-isolated *', srcAttribute: '../child?mode=test#fragment' },
    { allowAttribute: '', srcAttribute: '' },
    { allowAttribute: null, srcAttribute: null },
  ])('preserves potential-report attribute values %j through projection and serialization', (attributes) => {
    const { window, env, scope } = createWindow();
    const observer = new window.ReportingObserver(() => {}, { types: [potentialType] });
    observer.observe();
    const data = violation({
      sourceFile: 'https://document.test/app.js', lineNumber: 17, columnNumber: 0,
      disposition: 'report', ...attributes,
    });
    env.queueReport(potentialType, 'policy-preview', data);
    const report = observer.takeRecords()[0]!;
    expect(report.type).toBe(potentialType);
    expect(report.body).toBeInstanceOf(window.PermissionsPolicyViolationReportBody);
    expect(report.body!.toJSON()).toEqual(data);
    const serialized = JSON.parse(utf8Decode(ReportImpl.serialize(scope.reports))) as Array<{ body: object; }>;
    expect(serialized[0]!.body).toEqual(data);
  });

  it('delivers both report types on tasks, filters them, and replays the same report and body identities', () => {
    const { window, env, runTask } = createWindow();
    const batches: Report[][] = [];
    const all = new window.ReportingObserver((reports) => { batches.push(reports); });
    const potential = new window.ReportingObserver(() => {}, { types: [potentialType] });
    all.observe();
    potential.observe();
    env.queueReport(violationType, 'policy', violation());
    env.queueReport(potentialType, 'policy-preview', violation({ disposition: 'report', allowAttribute: '', srcAttribute: null }));
    expect(batches).toEqual([]);
    const filtered = potential.takeRecords();
    expect(filtered.map((report) => report.type)).toEqual([potentialType]);
    runTask();
    expect(batches).toHaveLength(1);
    expect(batches[0]!.map((report) => report.type)).toEqual([violationType, potentialType]);
    expect(batches[0]![1]).toBe(filtered[0]);
    expect(batches[0]![1]!.body).toBe(filtered[0]!.body);
    const replay = new window.ReportingObserver(() => {}, { buffered: true });
    replay.observe();
    const buffered = replay.takeRecords();
    expect(buffered[0]).toBe(batches[0]![0]);
    expect(buffered[0]!.body).toBe(batches[0]![0]!.body);
    expect(buffered[1]).toBe(filtered[0]);
  });

  it.each([violationType, potentialType])('keeps %s locally observable when outbound reporting is disabled', (type) => {
    const { window, env, scope } = createWindow();
    env.userAgent.reportDeliveryEnabled = false;
    const observer = new window.ReportingObserver(() => {}, { types: [type] });
    observer.observe();
    env.queueReport(type, '', violation());
    const reports = observer.takeRecords();
    expect(reports).toHaveLength(1);
    expect(reports[0]!.body).toBeInstanceOf(window.PermissionsPolicyViolationReportBody);
    expect(scope.reports).toEqual([]);
    expect(scope.reportBuffer).toHaveLength(1);
  });
});

// Supply report data explicitly to test body projection independently of producer checks.
function violation(overrides: Partial<PermissionsPolicyViolationReportBody> = {}): PermissionsPolicyViolationReportBody {
  return {
    featureId: 'cross-origin-isolated', sourceFile: null, lineNumber: null, columnNumber: null,
    disposition: 'enforce', ...overrides,
  };
}

// Real Window bindings and Reporting queues, with task turns controlled by the fixture.
function createWindow() {
  const traversable = TopLevelTraversable.create(createManualUserAgent(), null, '');
  const realm = getRelevantRealm(traversable.activeWindow!);
  return {
    window: realm.globalObject,
    realm,
    env: realm.env,
    scope: realm.env.getWindowOrWorkerGlobalScopeMixin(),
    runTask: () => realm.agent.eventLoop.runTaskTurn(),
  };
}
