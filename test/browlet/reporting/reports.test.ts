import { describe, expect, it } from 'vitest';
import { getBindingContext, getRelevantRealm } from '../../../src/browlet/bindings';
import { Browlet } from '../../../src/browlet/browlet';
import { ReportImpl, ReportBodyImpl } from '../../../src/browlet/reporting/report';
import type { IntegrityViolationReportBody } from '../../../src/fetch/integrity';
import { reference } from '../../../src/web-idl/index';

describe('Reporting platform objects', () => {
  it('exposes body interfaces without allowing author construction', () => {
    const window = createWindow();
    for (const name of ['ReportBody', 'IntegrityViolationReportBody']) {
      const constructor = Reflect.get(window, name) as new () => object;
      expect(typeof constructor).toBe('function');
      expect(() => new constructor()).toThrow(window.TypeError);
    }
    expect(Reflect.has(window, 'Report')).toBe(false);
  });

  it('projects a report with no body and serializes its public fields', () => {
    const window = createWindow();
    const report = projectReport(window, createReport(window, null));
    expect(report.type).toBe('test');
    expect(report.url).toBe('https://document.test/page');
    expect(report.body).toBeNull();
    expect(report.toJSON()).toEqual({ type: 'test', url: 'https://document.test/page', body: null });
    for (const name of ['data', 'origin', 'userAgent', 'destination', 'timestamp', 'attempts', 'cloneForDelivery']) {
      expect(Reflect.has(report, name)).toBe(false);
    }
    expect(Object.prototype.toString.call(report)).toBe('[object Report]');
  });

  it('preserves the concrete body interface through the base-typed Report.body attribute', () => {
    const window = createWindow();
    const context = getBindingContext(getRelevantRealm(window));
    const data = integrityBody();
    const reportImplementation = createReport(window, data);
    const implementation = reportImplementation.body!;
    const report = projectReport(window, reportImplementation);
    const body = report.body!;
    expect(body).toMatchObject(data);
    expect(body).toBeInstanceOf(window.ReportBody);
    expect(Object.getPrototypeOf(body)).toBe(window.IntegrityViolationReportBody.prototype);
    expect(Object.prototype.toString.call(body)).toBe('[object IntegrityViolationReportBody]');
    expect(report.body).toBe(body);
    expect(context.project(ReportBodyImpl, implementation)).toBe(body);
    expect(context.convertToImpl(body, reference('ReportBody'))).toBe(implementation);
    expect(context.convertToImpl(body, reference('IntegrityViolationReportBody'))).toBe(implementation);
  });

  it('serializes all derived fields through the default toJSON operations', () => {
    const window = createWindow();
    const data = integrityBody();
    const report = projectReport(window, createReport(window, data));
    const bodyJSON = report.body!.toJSON();
    expect(bodyJSON).toBeInstanceOf(window.Object);
    expect(bodyJSON).toEqual(data);
    expect(report.body!.toJSON()).not.toBe(bodyJSON);
    const reportJSON = report.toJSON();
    expect(reportJSON).toBeInstanceOf(window.Object);
    expect(reportJSON.body).toBe(report.body);
    expect(JSON.parse(window.JSON.stringify(report))).toEqual({
      type: 'integrity-violation', url: data.documentURL, body: data,
    });
  });

  it('keeps the body snapshot independent of producer data and exposes getter-only attributes', () => {
    const window = createWindow();
    const data = integrityBody();
    const expected = { ...data };
    const implementation = createReport(window, data);
    data.blockedURL = 'https://other.test/changed.js';
    data.reportOnly = false;
    const report = projectReport(window, implementation);
    expect(report.body!.toJSON()).toEqual(expected);
    expect(Reflect.set(report, 'type', 'changed')).toBe(false);
    expect(Reflect.set(report, 'body', null)).toBe(false);
    expect(Reflect.set(report.body!, 'blockedURL', data.blockedURL)).toBe(false);
    expect(Reflect.set(report.body!, 'reportOnly', false)).toBe(false);
    expect(report.body!.toJSON()).toEqual(expected);
  });

  it('retains an already projected body\'s identity and realm', () => {
    const owner = createWindow();
    const other = createWindow();
    const data = integrityBody();
    const implementation = createReport(other, data);
    const body = getBindingContext(getRelevantRealm(owner)).project(ReportBodyImpl, implementation.body!);
    const report = projectReport(other, implementation);
    expect(report).toBeInstanceOf(other.Object);
    expect(report.body).toBe(body);
    expect(report.body).toBeInstanceOf(owner.ReportBody);
    expect(report.body).not.toBeInstanceOf(other.ReportBody);
    expect(report.toJSON().body).toBe(body);
    expect(JSON.parse(other.JSON.stringify(report))).toEqual({
      type: 'integrity-violation', url: data.documentURL, body: data,
    });
  });

  it('allocates a borrowed toJSON result in the method realm without changing a fresh body\'s owner', () => {
    const owner = createWindow();
    const other = createWindow();
    const data = integrityBody();
    const report = projectReport(owner, createReport(owner, data));
    const foreignReport = projectReport(other, createReport(other, null));
    const json = foreignReport.toJSON.call(report);
    expect(json).toBeInstanceOf(other.Object);
    expect(json.body).toBeInstanceOf(owner.ReportBody);
    expect(json.body).toBe(report.body);
    expect(JSON.parse(other.JSON.stringify(json))).toEqual({
      type: 'integrity-violation', url: data.documentURL, body: data,
    });
  });
});

function createWindow(): ReportingWindow {
  return new Browlet({ route: () => '' }).window as ReportingWindow;
}

function createReport(window: object, data: IntegrityViolationReportBody | null): ReportImpl {
  const environment = getRelevantRealm(window).environment;
  const report = environment.generateReport(data, data === null ? 'test' : 'integrity-violation', 'default');
  report.url = data?.documentURL ?? 'https://document.test/page';
  return report;
}

function projectReport(window: object, implementation: ReportImpl): ReportObject {
  return getBindingContext(getRelevantRealm(window)).project(ReportImpl, implementation) as unknown as ReportObject;
}

function integrityBody(): IntegrityViolationReportBody {
  return {
    documentURL: 'https://document.test/page',
    blockedURL: 'https://resource.test/script.js',
    destination: 'script',
    reportOnly: true,
  };
}

// lib.dom still models Reporting's dictionaries instead of browser interfaces.
type ReportObject = {
  type: string;
  url: string;
  body: ReportBodyObject | null;
  toJSON(): { type: string; url: string; body: ReportBodyObject | null; };
};

type ReportBodyObject = { toJSON(): object; };

type ReportingWindow = Window & typeof globalThis & {
  ReportBody: new () => ReportBodyObject;
  IntegrityViolationReportBody: new () => ReportBodyObject & IntegrityViolationReportBody;
};
