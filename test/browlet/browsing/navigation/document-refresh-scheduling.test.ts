import { afterEach, assert, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { BrowsingContext, DocumentState, Navigable, TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/iframe';
import type { HTMLMetaElementImpl } from '../../../../src/browlet/dom/nodes/html/metadata/meta';
import { HTMLTreeAdapter } from '../../../../src/browlet/html/parser/index';
import type { HTMLMetaElement, NavigateEvent, Window } from '../../../../src/browlet/platform';
import { taskSources } from '../../../../src/browlet/scripting/index';
import { FetchResponse } from '../../../../src/fetch/index';
import { UnsafeMoment, wallClock } from '../../../../src/timing/index';
import { parseURL } from '../../../../src/url/index';
import { createManualUserAgent } from '../../../support/browlet-agent';
import { project } from '../../../support/browlet-binding';
import { runInHostTask } from '../../../support/tasks';

afterEach(() => { vi.restoreAllMocks(); });

describe('Document HTTP Refresh scheduling', () => {
  it('waits for complete loading, then counts the requested delay before queueing navigation', async () => {
    const { document, top, wakeups, setTime } = fixture();
    const navigate = vi.spyOn(top, 'navigate').mockImplementation(() => {});
    document.processDeclarativeRefresh('2;url=/next');
    expect(wakeups).toHaveLength(0);
    setTime(5_000);
    document.completelyFinishLoading();
    expect(wakeups.map((wakeup) => wakeup.delay)).toEqual([2_000]);
    setTime(7_000);
    wakeups[0]!.steps();
    expect(navigate).not.toHaveBeenCalled();
    const tasks = document.env.responsibleEventLoop.getTaskQueue(taskSources['navigation-and-traversal']);
    expect([...tasks].map((task) => task.document)).toEqual([document]);
    await runTurn(document);
    expect(navigate).toHaveBeenCalledExactlyOnceWith(
      parseURL('https://example.test/next').url!, document, { historyHandling: 'replace' }, document.env,
    );
  });

  it('queues an immediate refresh after loading without navigating inline or needing a timer', async () => {
    const { document, top, wakeups } = fixture();
    const navigate = vi.spyOn(top, 'navigate').mockImplementation(() => {});
    document.processDeclarativeRefresh('0;url=/next');
    expect(navigationTasks(document)).toHaveLength(0);
    document.completelyFinishLoading();
    expect(wakeups).toHaveLength(0);
    expect(navigate).not.toHaveBeenCalled();
    await runTurn(document);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it('uses the recorded load time when processing happens after loading', async () => {
    const { document, top, wakeups, setTime } = fixture();
    const navigate = vi.spyOn(top, 'navigate').mockImplementation(() => {});
    document.completelyFinishLoading();
    setTime(2_500);
    document.processDeclarativeRefresh('2;url=/next');
    expect(wakeups[0]!.delay).toBe(500);
    setTime(3_000);
    wakeups[0]!.steps();
    await runTurn(document);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it('starts the load-relative wait only after Window load handlers finish', async () => {
    const { document, top } = fixture();
    const platform = project(document.getRelevantGlobalObject()!) as Window;
    const order: string[] = [];
    platform.addEventListener('load', () => {
      order.push('load');
      expect(document.completelyLoadedTime).toBeNull();
      expect(navigationTasks(document)).toHaveLength(0);
    });
    vi.spyOn(top, 'navigate').mockImplementation(() => { order.push('navigate'); });
    document.processDeclarativeRefresh('0;url=/next');
    document.finishLoading();
    expect(order).toEqual(['load']);
    await runTurn(document);
    expect(order).toEqual(['load', 'navigate']);
  });

  it('uses a loaded child Document without waiting for its parent to finish loading', async () => {
    const { document, top } = fixture();
    const root = document.appendChild(document.createElement('html'));
    const container = root.appendChild(document.createElement('iframe')) as HTMLIFrameElementImpl;
    const [, child] = BrowsingContext.create(document, container, top.activeBrowsingContext!.group!);
    const navigable = new Navigable(DocumentState.create(child), top);
    container.contentNavigable = navigable;
    const navigate = vi.spyOn(navigable, 'navigate').mockImplementation(() => {});
    expect(document.completelyLoadedTime).toBeNull();
    expect(child.isFullyActive()).toBe(true);
    child.completelyFinishLoading();
    child.processDeclarativeRefresh('0;url=https://example.test/next');
    // Complete-loading now queues the container's separate notification before the refresh task.
    await runTurn(document);
    await runTurn(child);
    expect(navigate).toHaveBeenCalledExactlyOnceWith(
      parseURL('https://example.test/next').url!, child, { historyHandling: 'replace' }, child.env,
    );
    expect(document.completelyLoadedTime).toBeNull();
  });

  it('rechecks an early host wake-up instead of refreshing early', async () => {
    const { document, top, wakeups, setTime } = fixture();
    const navigate = vi.spyOn(top, 'navigate').mockImplementation(() => {});
    document.processDeclarativeRefresh('2;url=/next');
    document.completelyFinishLoading();
    setTime(1_500);
    wakeups[0]!.steps();
    expect(wakeups.map((wakeup) => wakeup.delay)).toEqual([2_000, 1_500]);
    expect(navigationTasks(document)).toHaveLength(0);
    setTime(3_000);
    wakeups[1]!.steps();
    await runTurn(document);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it('keeps huge accepted delays finite at the host boundary without turning them into immediate refreshes', () => {
    const { document, wakeups, setTime } = fixture();
    document.processDeclarativeRefresh(`${'9'.repeat(400)};url=/next`);
    document.completelyFinishLoading();
    expect(wakeups[0]!.delay).toBe(Number.MAX_SAFE_INTEGER);
    // The Node host limits each actual wake-up; the Document still owns the full deadline.
    setTime(1_000 + 2_147_483_647);
    wakeups[0]!.steps();
    expect(wakeups[1]!.delay).toBe(Number.MAX_SAFE_INTEGER);
    expect(navigationTasks(document)).toHaveLength(0);
    document.cancelDeclarativeRefresh();
    expect(wakeups[1]!.remove).toHaveBeenCalledOnce();
  });

  it('keeps cancellation before loading final without admitting a second directive', () => {
    const { document, wakeups } = fixture();
    document.processDeclarativeRefresh('1;url=/first');
    document.cancelDeclarativeRefresh();
    document.processDeclarativeRefresh('0;url=/second');
    document.completelyFinishLoading();
    expect(document.willDeclarativelyRefresh).toBe(true);
    expect(wakeups).toHaveLength(0);
    expect(navigationTasks(document)).toHaveLength(0);
  });

  it('removes a timer and ignores its captured wake-up after cancellation', () => {
    const { document, wakeups, setTime } = fixture();
    document.processDeclarativeRefresh('1;url=/next');
    document.completelyFinishLoading();
    document.cancelDeclarativeRefresh();
    document.cancelDeclarativeRefresh();
    expect(wakeups[0]!.remove).toHaveBeenCalledOnce();
    setTime(2_000);
    wakeups[0]!.steps();
    expect(navigationTasks(document)).toHaveLength(0);
  });

  it('removes an already queued navigation when canceled', async () => {
    const { document, top } = fixture();
    const navigate = vi.spyOn(top, 'navigate').mockImplementation(() => {});
    document.processDeclarativeRefresh('0;url=/next');
    document.completelyFinishLoading();
    const [task] = navigationTasks(document);
    document.cancelDeclarativeRefresh();
    expect(navigationTasks(document)).toHaveLength(0);
    // Even a retained continuation cannot revive canceled work.
    await runInHostTask(() => { task!.steps(); });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('releases pending state when the event loop discards its task', () => {
    const { document } = fixture();
    document.processDeclarativeRefresh('0;url=/next');
    document.completelyFinishLoading();
    document.env.responsibleEventLoop.removeTasksForDocument(document);
    document.completelyFinishLoading();
    expect(navigationTasks(document)).toHaveLength(0);
  });

  it.each(['abort', 'destroy', 'stop'] as const)('cancels pending Refresh during %s', async (operation) => {
    const { document, wakeups, setTime } = fixture();
    document.processDeclarativeRefresh('1;url=/next');
    document.completelyFinishLoading();
    document.env.queueTask('navigation-and-traversal', () => {
      if (operation === 'stop') (project(document.getRelevantGlobalObject()!) as Window).stop();
      else document[operation]();
    });
    await runTurn(document);
    expect(wakeups[0]!.remove).toHaveBeenCalledOnce();
    setTime(2_000);
    wakeups[0]!.steps();
    expect(navigationTasks(document)).toHaveLength(0);
  });

  it('cancels Refresh during unsalvageable unloading cleanup', () => {
    const { document, wakeups } = fixture();
    document.processDeclarativeRefresh('1;url=/next');
    document.completelyFinishLoading();
    document.salvageable = false;
    document.runUnloadingCleanup();
    expect(wakeups[0]!.remove).toHaveBeenCalledOnce();
  });

  it('keeps the captured Document as task owner after its Window is reassociated', async () => {
    const { document, top, wakeups, setTime } = fixture();
    const navigate = vi.spyOn(top, 'navigate').mockImplementation(() => {});
    document.processDeclarativeRefresh('1;url=/next');
    document.completelyFinishLoading();
    const window = document.getRelevantGlobalObject()!;
    const replacement = document.implementation.createHTMLDocument();
    window.setAssociatedDocument(replacement);
    expect(document.env.getAssociatedDocument()).toBe(replacement);
    setTime(2_000);
    wakeups[0]!.steps();
    expect(navigationTasks(document)[0]!.document).toBe(document);
    window.setAssociatedDocument(document);
    document.cancelDeclarativeRefresh();
    await runInHostTask(() => { expect(document.env.responsibleEventLoop.runTaskTurn()).toBe(false); });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not run a due refresh against a replacement Document', async () => {
    const { document, top, wakeups, setTime } = fixture();
    const navigate = vi.spyOn(top, 'navigate').mockImplementation(() => {});
    document.processDeclarativeRefresh('1;url=/next');
    document.completelyFinishLoading();
    const retainedEntry = top.activeSessionHistoryEntry;
    const previous = top.sessionHistoryEntries[0]!;
    top.activeSessionHistoryEntry = previous;
    previous.document!.makeActive();
    setTime(20_000);
    wakeups[0]!.steps();
    await runInHostTask(() => { expect(document.env.responsibleEventLoop.runTaskTurn()).toBe(false); });
    expect(navigate).not.toHaveBeenCalled();
    // Existing task runnability releases it only when this same Document is active again.
    top.activeSessionHistoryEntry = retainedEntry;
    document.makeActive();
    await runTurn(document);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it.each([
    ['0', 'reload', 'https://example.test/source', false],
    ['0;url=/next', 'replace', 'https://example.test/next', false],
    ['0;url=#part', 'replace', 'https://example.test/source#part', true],
  ] as const)('delivers a cancelable navigate event for %s through the existing navigation owner', async (input, type, url, sameDocument) => {
    const { document, top } = fixture();
    const window = document.getRelevantGlobalObject()!;
    // Supply the existing §6.4 dependency while exercising real navigation and projected events.
    const platform = project(window) as Window;
    const events: object[] = [];
    platform.navigation.addEventListener('navigate', (baseEvent) => {
      const event = baseEvent as NavigateEvent;
      events.push({
        type: event.navigationType, url: event.destination.url, sameDocument: event.destination.sameDocument,
        trusted: event.isTrusted, cancelable: event.cancelable, userInitiated: event.userInitiated,
      });
      event.preventDefault();
    }, { once: true });
    document.processDeclarativeRefresh(input);
    document.completelyFinishLoading();
    await runTurn(document);
    expect(events).toEqual([{ type, url, sameDocument, trusted: true, cancelable: true, userInitiated: false }]);
    expect(top.activeDocument).toBe(document);
    expect(top.activeSessionHistoryEntry.documentState.reloadPending).toBe(false);
    expect(navigationTasks(document)).toHaveLength(0);
  });

  it('delivers a Refresh navigation using the Window\'s actual transient-activation state', async () => {
    const { document } = fixture();
    const platform = project(document.getRelevantGlobalObject()!) as Window;
    const received = vi.fn();
    platform.navigation.addEventListener('navigate', (event) => {
      event.preventDefault();
      received();
    });
    document.processDeclarativeRefresh('0;url=/next');
    document.completelyFinishLoading();
    await runTurn(document);
    expect(received).toHaveBeenCalledOnce();
  });

  it('compares the captured target with the current URL at dispatch', async () => {
    const { document, top } = fixture();
    const reload = vi.spyOn(top, 'reload').mockImplementation(() => {});
    const navigate = vi.spyOn(top, 'navigate').mockImplementation(() => {});
    document.processDeclarativeRefresh('0');
    document.setURL(parseURL('https://example.test/changed').url!);
    document.completelyFinishLoading();
    await runTurn(document);
    expect(reload).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledExactlyOnceWith(
      parseURL('https://example.test/source').url!, document, { historyHandling: 'replace' }, document.env,
    );
  });

  it('requires an insertion time when an internal caller supplies a meta element', () => {
    const { document, wakeups } = fixture();
    const meta = document.createElement('meta') as HTMLMetaElementImpl;
    expect(() => document.processDeclarativeRefresh('0;url=/next', meta))
      .toThrow('Meta refresh requires a Document insertion time');
    expect(wakeups).toHaveLength(0);
    expect(navigationTasks(document)).toHaveLength(0);
  });
});

describe('Meta Refresh insertion and scheduling', () => {
  it('exposes the reflected attributes and schedules only when the configured element is inserted', async () => {
    const { document, top } = fixture();
    new HTMLTreeAdapter(document).parse('<!doctype html><title>Refresh</title>');
    const navigate = vi.spyOn(top, 'navigate').mockImplementation(() => {});
    const platform = project(document.getRelevantGlobalObject()!) as Window;
    const meta = platform.document.createElement('meta') as HTMLMetaElement;
    expect(meta).toBeInstanceOf(platform.HTMLMetaElement);
    expect([meta.name, meta.httpEquiv, meta.content, meta.media]).toEqual(['', '', '', '']);
    meta.name = 'description';
    meta.httpEquiv = 'ReFrEsH';
    meta.content = '0;url=/next';
    meta.media = 'screen';
    expect(['name', 'http-equiv', 'content', 'media'].map((name) => meta.getAttribute(name)))
      .toEqual(['description', 'ReFrEsH', '0;url=/next', 'screen']);
    expect(document.willDeclarativelyRefresh).toBe(false);
    platform.document.head!.appendChild(meta);
    document.completelyFinishLoading();
    expect(navigate).not.toHaveBeenCalled();
    await runTurn(document);
    expect(navigate).toHaveBeenCalledExactlyOnceWith(
      parseURL('https://example.test/next').url!, document, { historyHandling: 'replace' }, document.env,
    );
    meta.removeAttribute('content');
    expect(meta.content).toBe('');
  });

  it.each(['head', 'body'])('accepts parser insertion in %s and waits for load handlers before dispatch', async (parent) => {
    const { document } = fixture();
    const window = document.getRelevantGlobalObject()!;
    const platform = project(window) as Window;
    const order: string[] = [];
    platform.addEventListener('load', () => { order.push('load'); });
    platform.navigation.addEventListener('navigate', (baseEvent) => {
      const event = baseEvent as NavigateEvent;
      order.push(`${event.navigationType}:${event.destination.url}`);
      expect(event.isTrusted).toBe(true);
      event.preventDefault();
    });
    new HTMLTreeAdapter(document).parse(`<!doctype html><${parent}><meta http-equiv=refresh content="0;url=/parsed"></${parent}>`);
    expect(document.willDeclarativelyRefresh).toBe(true);
    expect(order).toEqual([]);
    expect(navigationTasks(document)).toHaveLength(0);
    document.finishLoading();
    expect(order).toEqual(['load']);
    await runTurn(document);
    expect(order).toEqual(['load', 'replace:https://example.test/parsed']);
  });

  it('reaches navigation through the ordinary loader and host task scheduler', async () => {
    const navigate = vi.spyOn(Navigable.prototype, 'navigate').mockImplementation(() => {});
    const browlet = new Browlet({ route: () => '<!doctype html><meta http-equiv=refresh content="0;url=/next">' });
    await browlet.navigate('https://example.test/source');
    await expect.poll(() => navigate.mock.calls.length).toBe(1);
    const [url, document] = navigate.mock.calls[0]!;
    assert(document);
    expect(url).toEqual(parseURL('https://example.test/next').url!);
    expect(document.readyState).toBe('complete');
    expect(document.completelyLoadedTime).not.toBeNull();
  });

  it.each([
    ['insertion before load', 1_000, 5_000],
    ['insertion after load', 5_000, 1_000],
  ] as const)('counts the delay from the later timestamp: %s', async (_name, inserted, loaded) => {
    const { document, top, wakeups, setTime } = fixture();
    const root = document.appendChild(document.createElement('html'));
    const navigate = vi.spyOn(top, 'navigate').mockImplementation(() => {});
    if (loaded < inserted) {
      setTime(loaded);
      document.completelyFinishLoading();
    }
    setTime(inserted);
    root.appendChild(createMeta(document, '2;url=/next'));
    if (inserted < loaded) {
      expect(wakeups).toHaveLength(0);
      setTime(loaded);
      document.completelyFinishLoading();
    }
    expect(wakeups.map((wakeup) => wakeup.delay)).toEqual([2_000]);
    setTime(7_000);
    wakeups[0]!.steps();
    await runTurn(document);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it.each(['detached subtree', 'fragment', 'shadow'] as const)('ignores a %s until the meta enters a Document tree', (kind) => {
    const { document, wakeups } = fixture();
    const root = document.appendChild(document.createElement('html'));
    const meta = createMeta(document, '1;url=/next');
    const parent = kind === 'fragment' ? document.createDocumentFragment() : kind === 'detached subtree'
      ? document.createElement('div') : root.appendChild(document.createElement('div')).attachShadow({
        mode: 'open', delegatesFocus: false, slotAssignment: 'named', clonable: false, serializable: false,
      });
    parent.appendChild(meta);
    document.completelyFinishLoading();
    expect(document.willDeclarativelyRefresh).toBe(false);
    expect(wakeups).toHaveLength(0);
    root.appendChild(meta);
    expect(document.willDeclarativelyRefresh).toBe(true);
    expect(wakeups.map((wakeup) => wakeup.delay)).toEqual([1_000]);
  });

  it('processes descendant meta elements when a populated fragment enters the Document', () => {
    const { document, wakeups } = fixture();
    const root = document.appendChild(document.createElement('html'));
    const fragment = document.createDocumentFragment();
    fragment.appendChild(document.createElement('div')).appendChild(createMeta(document, '1;url=/next'));
    document.completelyFinishLoading();
    expect(document.willDeclarativelyRefresh).toBe(false);
    root.appendChild(fragment);
    expect(wakeups.map((wakeup) => wakeup.delay)).toEqual([1_000]);
  });

  it.each([null, '', 'not-a-delay', '0;url=javascript:alert(1)'])('leaves admission open for missing/invalid content %s', (input) => {
    const { document, wakeups } = fixture();
    const root = document.appendChild(document.createElement('html'));
    const meta = createMeta(document, '');
    if (input === null) meta.removeAttribute('content');
    else meta.setAttribute('content', input);
    root.appendChild(meta);
    expect(document.willDeclarativelyRefresh).toBe(false);
    root.appendChild(createMeta(document, '1;url=/valid'));
    document.completelyFinishLoading();
    expect(wakeups.map((wakeup) => wakeup.delay)).toEqual([1_000]);
  });

  it.each(['content', 'http-equiv'])('does not activate an inserted element when %s changes; reinsertion uses the new attributes', async (attribute) => {
    const { document, top, wakeups, setTime } = fixture();
    const root = document.appendChild(document.createElement('html'));
    const navigate = vi.spyOn(top, 'navigate').mockImplementation(() => {});
    document.completelyFinishLoading();
    const meta = createMeta(document, '1;url=/next');
    meta.removeAttribute(attribute);
    root.appendChild(meta);
    setTime(2_000);
    meta.setAttribute(attribute, attribute === 'content' ? '1;url=/next' : 'refresh');
    expect(document.willDeclarativelyRefresh).toBe(false);
    expect(wakeups).toHaveLength(0);
    meta.remove();
    setTime(2_500);
    root.appendChild(meta);
    expect(wakeups.map((wakeup) => wakeup.delay)).toEqual([1_000]);
    setTime(3_500);
    wakeups[0]!.steps();
    await runTurn(document);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it('does not accept a whitespace-padded keyword or namespaced attributes', () => {
    const { document, wakeups } = fixture();
    const root = document.appendChild(document.createElement('html'));
    const padded = createMeta(document, '0;url=/next');
    padded.setAttribute('http-equiv', ' refresh ');
    root.appendChild(padded);
    const foreign = createMeta(document, '0;url=/next');
    foreign.removeAttribute('http-equiv');
    foreign.setAttributeNS('urn:test', 'x:http-equiv', 'refresh');
    root.appendChild(foreign);
    document.completelyFinishLoading();
    expect(document.willDeclarativelyRefresh).toBe(false);
    expect(wakeups).toHaveLength(0);
    expect(navigationTasks(document)).toHaveLength(0);
  });

  it.each(['remove', 'reinsert', 'adopt'] as const)('preserves the captured Document, target, and deadline after %s', async (action) => {
    const { document, top, wakeups, setTime } = fixture();
    const root = document.appendChild(document.createElement('html'));
    const base = root.appendChild(document.createElement('base'));
    base.setAttribute('href', '/captured/');
    const navigate = vi.spyOn(top, 'navigate').mockImplementation(() => {});
    document.completelyFinishLoading();
    const meta = root.appendChild(createMeta(document, '1;url=next'));
    setTime(1_500);
    meta.remove();
    meta.setAttribute('content', '8;url=/changed');
    base.setAttribute('href', '/changed-base/');
    if (action === 'reinsert') root.appendChild(meta);
    if (action === 'adopt') {
      const other = document.implementation.createHTMLDocument();
      other.activeSandboxingFlagSet.add('sandboxed-automatic-features');
      other.body!.appendChild(meta);
      expect(meta.nodeDocument).toBe(other);
    }
    expect(wakeups).toHaveLength(1);
    expect(wakeups[0]!.remove).not.toHaveBeenCalled();
    setTime(2_000);
    wakeups[0]!.steps();
    await runTurn(document);
    expect(navigate).toHaveBeenCalledExactlyOnceWith(
      parseURL('https://example.test/captured/next').url!, document, { historyHandling: 'replace' }, document.env,
    );
  });

  it.each(['meta first', 'header first'] as const)('keeps the first valid directive across header/meta inputs: %s', async (order) => {
    const { document, top } = fixture();
    const root = document.appendChild(document.createElement('html'));
    const navigate = vi.spyOn(top, 'navigate').mockImplementation(() => {});
    if (order === 'header first') document.processDeclarativeRefresh('0;url=/header');
    root.appendChild(createMeta(document, '0;url=/meta'));
    if (order === 'meta first') document.processDeclarativeRefresh('0;url=/header');
    root.appendChild(createMeta(document, '0;url=/later-meta'));
    document.completelyFinishLoading();
    await runTurn(document);
    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate.mock.calls[0]![0]).toEqual(parseURL(`https://example.test/${order === 'meta first' ? 'meta' : 'header'}`).url!);
  });

  it.each(['meta', 'header'] as const)('applies the automatic-features sandbox restriction to %s Refresh', async (source) => {
    const { document, top } = fixture();
    const navigate = vi.spyOn(top, 'navigate').mockImplementation(() => {});
    if (source === 'meta') {
      document.appendChild(document.createElement('html')).appendChild(createMeta(document, '0;url=/next'));
    } else {
      document.processDeclarativeRefresh('0;url=/next');
    }
    document.completelyFinishLoading();
    // Read the captured Document's flags when due, not its element's later node Document.
    document.activeSandboxingFlagSet.add('sandboxed-automatic-features');
    await runTurn(document);
    expect(navigate).toHaveBeenCalledTimes(source === 'meta' ? 0 : 1);
    expect(document.willDeclarativelyRefresh).toBe(true);
    expect(navigationTasks(document)).toHaveLength(0);
  });
});

function createMeta(document: DocumentImpl, input: string): HTMLMetaElementImpl {
  const meta = document.createElement('meta') as HTMLMetaElementImpl;
  meta.setAttribute('http-equiv', 'refresh');
  meta.setAttribute('content', input);
  return meta;
}

function fixture() {
  const userAgent = createManualUserAgent();
  const wakeups: { delay: number; steps: () => void; remove: ReturnType<typeof vi.fn>; }[] = [];
  userAgent.timerHost = {
    scheduleTimeout(delay, steps) {
      const wakeup = { delay, steps, remove: vi.fn() };
      wakeups.push(wakeup);
      return wakeup;
    },
  };
  const top = TopLevelTraversable.create(userAgent, null, '');
  const response = new FetchResponse();
  response.urlList.push(parseURL('https://example.test/source').url!);
  const params = top.createNavigationParams(response);
  const document = top.createAndInitializeDocument('html', 'text/html', params);
  const entry = top.createHistoryEntry(document, params);
  top.sessionHistoryEntries.push(entry);
  top.activeSessionHistoryEntry = top.currentSessionHistoryEntry = entry;
  document.makeActive();
  let now = 1_000;
  vi.spyOn(wallClock, 'unsafeCurrentTime').mockImplementation(() => new UnsafeMoment(wallClock, now));
  return { document, top, userAgent, wakeups, setTime: (value: number) => { now = value; } };
}

async function runTurn(document: DocumentImpl): Promise<void> {
  await runInHostTask(() => { expect(document.env.responsibleEventLoop.runTaskTurn()).toBe(true); });
}

function navigationTasks(document: DocumentImpl) {
  return [...document.env.responsibleEventLoop.getTaskQueue(taskSources['navigation-and-traversal'])];
}
