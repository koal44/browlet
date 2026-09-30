import { describe, expect, it, vi } from 'vitest';
import { createDocument, getRelevantRealm, setAssociatedWindow } from '../../../src/browlet/bindings';
import { Browlet } from '../../../src/browlet/browlet';
import { BrowsingContext } from '../../../src/browlet/browsing/browsing-context';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigable';
import { monotonicClock, UnsafeMoment } from '../../../src/browlet/performance/clock';
import { UserAgent } from '../../../src/browlet/user-agent';
import { WindowAgent } from '../../../src/browlet/scripting/agents';
import { createWindowEnvironment } from '../../../src/browlet/bindings';
import { FetchRequest } from '../../../src/fetch/request';
import { FetchResponse } from '../../../src/fetch/response';
import { parseURL } from '../../../src/url/url';

describe('ReportingObserver', () => {
  it('exposes the constructor and enforces callback and options conversion', () => {
    const { window } = createWindow();
    expect(typeof window.ReportingObserver).toBe('function');
    expect(window.ReportingObserver.length).toBe(1);
    expect(() => { Reflect.construct(window.ReportingObserver, []); }).toThrow(window.TypeError);
    expect(() => { Reflect.construct(window.ReportingObserver, [null]); }).toThrow(window.TypeError);
    expect(() => { Reflect.construct(window.ReportingObserver, [() => {}, { types: 1 }]); }).toThrow(window.TypeError);
    expect(() => window.ReportingObserver.prototype.observe.call({})).toThrow(window.TypeError);
    expect(new window.ReportingObserver(() => {}).takeRecords()).toEqual([]);
  });

  it('delivers an asynchronous batch through the running HTML event loop', async () => {
    const browlet = new Browlet({ route: () => '' });
    const env = getRelevantRealm(browlet.window).env;
    await browlet.exposeFunction('produceReports', () => {
      env.queueReport('coep', 'reports', coepBody());
      env.queueReport('integrity-violation', 'reports', integrityBody());
    });
    const result = await browlet.evaluate(() => new Promise<object>((resolve) => {
      const { ReportingObserver, ReportBody } = globalThis as unknown as ReportingWindow;
      const produceReports = Reflect.get(globalThis, 'produceReports') as () => Promise<void>;
      const observer = new ReportingObserver(function(reports, argument) {
        resolve({
          receiver: this === observer, argument: argument === observer,
          array: reports instanceof Array,
          bodies: reports.map((report) => report.body instanceof ReportBody),
          records: reports.map((report) => JSON.parse(JSON.stringify(report)) as object),
          drained: observer.takeRecords().length,
        });
      });
      observer.observe();
      void produceReports();
    }));
    expect(result).toEqual({
      receiver: true, argument: true, array: true, bodies: [true, true], drained: 0,
      records: [
        { type: 'coep', url: 'about', body: coepBody() },
        { type: 'integrity-violation', url: 'about', body: integrityBody() },
      ],
    });
  });

  it('batches reports in generation order and does not register an observer twice', () => {
    const { window, env, runTask } = createWindow();
    const callback = vi.fn<ObserverCallback>();
    const observer = new window.ReportingObserver(callback);
    observer.observe();
    observer.observe();
    env.queueReport('coep', 'reports', coepBody());
    env.queueReport('integrity-violation', 'reports', integrityBody());
    expect(callback).not.toHaveBeenCalled();
    expect(runTask()).toBe(true);
    expect(callback).toHaveBeenCalledOnce();
    expect(callback.mock.calls[0]![0].map((report) => report.type)).toEqual(['coep', 'integrity-violation']);
    expect(callback.mock.calls[0]![1]).toBe(observer);
    expect(callback.mock.contexts[0]).toBe(observer);
    expect(observer.takeRecords()).toEqual([]);
    expect(runTask()).toBe(false);
  });

  it('applies converted type filters and hides report types not defined as observable', () => {
    const { window, env, scope } = createWindow();
    const types = [{ toString: () => 'coep' }];
    const filtered = Reflect.construct(window.ReportingObserver, [() => {}, { types }]) as ObserverObject;
    const all = new window.ReportingObserver(() => {}, { types: [] });
    filtered.observe();
    all.observe();
    types[0] = { toString: () => 'integrity-violation' };
    env.queueReport('coep', 'reports', coepBody());
    env.queueReport('integrity-violation', 'reports', integrityBody());
    env.queueReport('future-type', 'reports', { message: 'hidden' });
    expect(filtered.takeRecords().map((report) => report.type)).toEqual(['coep']);
    expect(all.takeRecords().map((report) => report.type)).toEqual(['coep', 'integrity-violation']);
    expect(scope.reports.map((report) => report.type)).toEqual(['coep', 'integrity-violation', 'future-type']);
  });

  it('shares report and body identity across observers and buffered replay', () => {
    const { window, env } = createWindow();
    const first = new window.ReportingObserver(() => {});
    const second = new window.ReportingObserver(() => {});
    first.observe();
    second.observe();
    env.queueReport('coep', 'reports', coepBody());
    const [report] = first.takeRecords();
    const [other] = second.takeRecords();
    expect(other).toBe(report);
    expect(other!.body).toBe(report!.body);

    const buffered = new window.ReportingObserver(() => {}, { buffered: true });
    buffered.observe();
    const [replayed] = buffered.takeRecords();
    expect(replayed).toBe(report);
    expect(replayed!.body).toBe(report!.body);
  });

  it('generates an observable test report with a hidden, typed message body', () => {
    const { window, scope } = createWindow();
    const observer = new window.ReportingObserver(() => {}, { types: ['test'] });
    observer.observe();
    scope.generateTestReport('A test message');
    const [report] = observer.takeRecords();
    expect(report!.type).toBe('test');
    expect(report!.body).toBeInstanceOf(window.ReportBody);
    expect(Object.prototype.toString.call(report!.body)).toBe('[object TestReportBody]');
    expect(report!.body!.toJSON()).toEqual({ message: 'A test message' });
    expect(Reflect.set(report!.body!, 'message', 'changed')).toBe(false);
    expect(Reflect.has(window, 'TestReportBody')).toBe(false);
    expect(scope.reports[0]!.destination).toBe('default');
  });

  it('preserves an explicit test-report destination and empty message', () => {
    const { window, scope } = createWindow();
    scope.generateTestReport('', 'custom');
    expect(scope.reports[0]).toMatchObject({ destination: 'custom', body: { message: '' } });
    const observer = new window.ReportingObserver(() => {}, { types: ['test'], buffered: true });
    observer.observe();
    expect(observer.takeRecords()[0]!.body!.toJSON()).toEqual({ message: '' });
  });

  it('keeps local test-report observation available when outbound reporting is disabled', () => {
    const { window, scope, env } = createWindow();
    env.userAgent.reportDeliveryEnabled = false;
    const observer = new window.ReportingObserver(() => {});
    observer.observe();
    scope.generateTestReport('local');
    expect(scope.reports).toEqual([]);
    expect(observer.takeRecords()[0]!.body!.toJSON()).toEqual({ message: 'local' });
  });

  it('makes buffered reports available during observe and replays them only once', () => {
    const { window, env } = createWindow();
    env.queueReport('coep', 'reports', coepBody());
    const unbuffered = new window.ReportingObserver(() => {});
    const buffered = new window.ReportingObserver(() => {}, { buffered: true });
    unbuffered.observe();
    buffered.observe();
    expect(unbuffered.takeRecords()).toEqual([]);
    expect(buffered.takeRecords().map((report) => report.type)).toEqual(['coep']);
    buffered.disconnect();
    env.queueReport('integrity-violation', 'reports', integrityBody());
    buffered.observe();
    expect(buffered.takeRecords()).toEqual([]);
    env.queueReport('coep', 'reports', coepBody());
    expect(buffered.takeRecords().map((report) => report.type)).toEqual(['coep']);
  });

  it('retains the latest 100 buffered reports per type in generation order', () => {
    const { window, env, scope } = createWindow();
    for (let index = 0; index <= 100; index++) {
      env.queueReport('coep', 'reports', coepBody(`https://resource.test/${index}`));
      env.queueReport('integrity-violation', 'reports', integrityBody());
    }
    const observer = new window.ReportingObserver(() => {}, { buffered: true });
    observer.observe();
    const records = observer.takeRecords();
    expect(scope.reports).toHaveLength(202);
    expect(scope.reportBuffer).toHaveLength(200);
    expect(records).toHaveLength(200);
    expect(records[0]!.body!.toJSON()).toMatchObject({ blockedURL: 'https://resource.test/1' });
    expect(records[198]!.body!.toJSON()).toMatchObject({ blockedURL: 'https://resource.test/100' });
    expect(records.map((record) => record.type)).toEqual(
      Array.from({ length: 100 }, () => ['coep', 'integrity-violation']).flat(),
    );
  });

  it('takeRecords drains only the observer and suppresses an empty callback', () => {
    const { window, env, scope, runTask } = createWindow();
    const callback = vi.fn<ObserverCallback>();
    const observer = new window.ReportingObserver(callback);
    observer.observe();
    env.queueReport('coep', 'reports', coepBody());
    const records = observer.takeRecords();
    expect(records).toHaveLength(1);
    expect(records).toBeInstanceOf(window.Array);
    expect(observer.takeRecords()).toEqual([]);
    expect(scope.reportBuffer).toHaveLength(1);
    expect(scope.reports).toHaveLength(1);
    expect(runTask()).toBe(true);
    expect(callback).not.toHaveBeenCalled();
  });

  it('disconnect stops new reports but preserves the pending callback batch', () => {
    const { window, env, runTask } = createWindow();
    const callback = vi.fn<ObserverCallback>();
    const observer = new window.ReportingObserver(callback);
    observer.observe();
    env.queueReport('coep', 'reports', coepBody());
    observer.disconnect();
    observer.disconnect();
    env.queueReport('integrity-violation', 'reports', integrityBody());
    runTask();
    expect(callback).toHaveBeenCalledOnce();
    expect(callback.mock.calls[0]![0].map((report) => report.type)).toEqual(['coep']);
  });

  it('clears a batch before author code and queues newly generated reports for another task', () => {
    const { window, env, runTask } = createWindow();
    const batches: string[][] = [];
    const observer = new window.ReportingObserver((reports) => {
      batches.push(reports.map((report) => report.type));
      expect(observer.takeRecords()).toEqual([]);
      if (batches.length === 1) env.queueReport('coep', 'reports', coepBody());
    });
    observer.observe();
    env.queueReport('integrity-violation', 'reports', integrityBody());
    runTask();
    expect(batches).toEqual([['integrity-violation']]);
    runTask();
    expect(batches).toEqual([['integrity-violation'], ['coep']]);
  });

  it('reports callback exceptions without preventing another observer from receiving its batch', () => {
    const { window, realm, env, runTask } = createWindow();
    const error = new window.Error('observer failed');
    const reported = vi.spyOn(realm, 'reportException').mockImplementation(() => {});
    const first = new window.ReportingObserver(() => { throw error; });
    const secondCallback = vi.fn();
    const second = new window.ReportingObserver(secondCallback);
    first.observe();
    second.observe();
    env.queueReport('coep', 'reports', coepBody());
    runTask();
    expect(reported).toHaveBeenCalledExactlyOnceWith(error);
    expect(secondCallback).toHaveBeenCalledOnce();
    runTask();
    expect(secondCallback).toHaveBeenCalledOnce();
  });

  it('keeps separate registrations, queues, and buffers for each global', () => {
    const first = createWindow();
    const second = createWindow();
    const observer = new second.window.ReportingObserver(() => {}, { buffered: true });
    observer.observe();
    first.env.queueReport('coep', 'reports', coepBody());
    expect(observer.takeRecords()).toEqual([]);
    expect(first.scope.reports).toHaveLength(1);
    expect(second.scope.reports).toHaveLength(0);
    expect(second.scope.reportBuffer).toHaveLength(0);
  });

  it('uses the callback realm for the array while retaining the observer realm for platform objects', () => {
    const owner = createWindow();
    // Author callbacks can cross same-agent realms, not unrelated event loops.
    const { agent } = owner.realm;
    if (!(agent instanceof WindowAgent)) throw new Error('Expected a Window agent');
    const sibling = createWindowEnvironment({
      agent, userAgent: owner.env.userAgent, creationURL: owner.env.creationURL,
      origin: owner.env.origin, parent: null,
      topLevelCreationURL: owner.env.creationURL, topLevelOrigin: owner.env.origin,
    });
    const otherRealm = sibling.realm;
    const proxy = otherRealm.windowProxy;
    const document = createDocument(otherRealm);
    document.browsingContext = new BrowsingContext(proxy);
    sibling.window.setAssociatedDocument(document);
    setAssociatedWindow(proxy, sibling.window);
    const otherWindow = otherRealm.global as unknown as ReportingWindow;
    const callback = otherRealm.evaluate(`(function(reports, observer) {
      globalThis.delivered = { reports, observer, receiver: this };
    })`, 'reporting-callback.js') as ObserverCallback;
    const observer = new owner.window.ReportingObserver(callback);
    observer.observe();
    owner.env.queueReport('coep', 'reports', coepBody());
    owner.runTask();
    const delivered = Reflect.get(otherWindow, 'delivered') as {
      reports: ReportObject[]; observer: ObserverObject; receiver: ObserverObject;
    };
    expect(delivered.reports).toBeInstanceOf(otherWindow.Array);
    expect(delivered.reports[0]).toBeInstanceOf(owner.window.Object);
    expect(delivered.reports[0]!.body).toBeInstanceOf(owner.window.ReportBody);
    expect(delivered.observer).toBe(observer);
    expect(delivered.receiver).toBe(observer);
  });
});

describe('Reporting policy integration and user control', () => {
  it.each([true, false])('reports enforced and report-only CORP violations with delivery enabled: %s', (enabled) => {
    const { window, env, scope } = createWindow();
    env.userAgent.reportDeliveryEnabled = enabled;
    env.policyContainer.embedderPolicy.value = 'require-corp';
    env.policyContainer.embedderPolicy.reportingEndpoint = 'enforce';
    env.policyContainer.embedderPolicy.reportOnlyValue = 'require-corp';
    env.policyContainer.embedderPolicy.reportOnlyReportingEndpoint = 'observe';
    const observer = new window.ReportingObserver(() => {});
    observer.observe();
    const response = new FetchResponse();
    response.urlList.push(parseURL('https://user:secret@resource.test/image.png#fragment').url!);
    expect(response.isBlockedByCORP(env.origin, env.policyContainer.embedderPolicy, 'image', false, env)).toBe(true);
    const reports = observer.takeRecords();
    expect(reports.map((report) => report.body!.toJSON())).toEqual([
      { type: 'corp', blockedURL: 'https://resource.test/image.png', destination: 'image', disposition: 'reporting' },
      { type: 'corp', blockedURL: 'https://resource.test/image.png', destination: 'image', disposition: 'enforce' },
    ]);
    expect(reports[0]!.body).toBeInstanceOf(window.ReportBody);
    expect(Object.prototype.toString.call(reports[0]!.body)).toBe('[object COEPViolationReportBody]');
    expect(Reflect.has(window, 'COEPViolationReportBody')).toBe(false);
    expect(scope.reports).toHaveLength(enabled ? 2 : 0);
    expect(scope.reportBuffer).toHaveLength(2);
  });

  it.each([true, false])('preserves Integrity Policy enforcement and boolean fields with delivery enabled: %s', (enabled) => {
    const { window, env, scope } = createWindow();
    env.userAgent.reportDeliveryEnabled = enabled;
    const response = new FetchResponse();
    response.headerList.append('Integrity-Policy', 'blocked-destinations=(script), endpoints=(enforce)');
    response.headerList.append('Integrity-Policy-Report-Only', 'blocked-destinations=(script), endpoints=(observe)');
    env.policyContainer.parseIntegrityPolicyHeaders(response);
    const observer = new window.ReportingObserver(() => {});
    observer.observe();
    const request = new FetchRequest(parseURL('https://resource.test/script.js').url!, env, env.userAgent);
    request.destination = 'script';
    request.mode = 'cors';
    request.populateFromClient();
    expect(request.isBlockedByIntegrityPolicy()).toBe(true);
    const reports = observer.takeRecords();
    expect(reports.map((report) => report.body!.toJSON())).toEqual([
      { ...integrityBody(), documentURL: 'about', reportOnly: false },
      { ...integrityBody(), documentURL: 'about', reportOnly: true },
    ]);
    expect(reports[0]!.body).toBeInstanceOf(window.IntegrityViolationReportBody);
    expect(scope.reports).toHaveLength(enabled ? 2 : 0);
  });

  it('configures outbound opt-out without disabling local callbacks or buffering', async () => {
    const browlet = new Browlet({ route: () => '', reporting: false });
    const realm = getRelevantRealm(browlet.window);
    const env = realm.env;
    const scope = realm.windowImplementation.getWindowOrWorkerGlobalScopeMixin();
    await browlet.exposeFunction('produceReport', () => {
      env.queueReport('coep', 'reports', coepBody());
    });
    expect(await browlet.evaluate(() => new Promise<number>((resolve) => {
      const produceReport = Reflect.get(globalThis, 'produceReport') as () => Promise<void>;
      const observer = new ReportingObserver((reports) => resolve(reports.length));
      observer.observe();
      void produceReport();
    }))).toBe(1);
    expect(scope.reports).toEqual([]);
    expect(scope.reportBuffer).toHaveLength(1);
  });
});

// Real Window bindings and an unstarted HTML event loop let scheduling tests choose task turns.
function createWindow() {
  const traversable = TopLevelTraversable.create(new UserAgent(), null, '');
  const realm = getRelevantRealm(traversable.activeWindow!);
  const eventLoop = realm.agent.eventLoop;
  return {
    realm,
    window: realm.global as unknown as ReportingWindow,
    env: realm.env,
    scope: realm.windowImplementation.getWindowOrWorkerGlobalScopeMixin(),
    runTask: () => eventLoop.runTaskTurn({
      createMicrotaskQueue: () => eventLoop.microtaskQueue,
      requestEventLoopTurn: vi.fn(),
      unsafeSharedCurrentTime: () => new UnsafeMoment(monotonicClock, 0),
    }),
  };
}

function coepBody(blockedURL = 'https://resource.test/image.png') {
  return { type: 'corp', blockedURL, destination: 'image', disposition: 'enforce' };
}

function integrityBody() {
  return {
    documentURL: 'https://document.test/page', blockedURL: 'https://resource.test/script.js',
    destination: 'script', reportOnly: true,
  };
}

// lib.dom still models Report and ReportBody as dictionaries rather than browser interfaces.
type ReportObject = { type: string; url: string; body: { toJSON(): object; } | null; };
type ObserverObject = { observe(): void; disconnect(): void; takeRecords(): ReportObject[]; };
type ObserverCallback = (this: ObserverObject, reports: ReportObject[], observer: ObserverObject) => void;
type ReportingWindow = Omit<Window & typeof globalThis, 'ReportingObserver'> & {
  ReportingObserver: {
    new (callback: ObserverCallback, options?: { types?: string[]; buffered?: boolean; }): ObserverObject;
    prototype: ObserverObject;
  };
  ReportBody: new () => object;
  IntegrityViolationReportBody: new () => object;
};
