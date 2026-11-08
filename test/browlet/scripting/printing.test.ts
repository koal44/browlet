import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { BrowsingContext, Navigable, TopLevelTraversable } from '../../../src/browlet/browsing/navigation/index';
import { DocumentState } from '../../../src/browlet/browsing/navigation/state/index';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import type { HTMLIFrameElementImpl } from '../../../src/browlet/dom/nodes/html/embedded/iframe';
import type { WindowImpl } from '../../../src/browlet/browsing/window/window';
import { domManipulationTaskSource } from '../../../src/browlet/scripting/tasks';
import { createManualUserAgent } from '../../support/browlet-agent';
import { unwrap } from '../../support/browlet-binding';
import { useFixture } from '../../support/fixture';
import { runInHostTask } from '../../support/tasks';

describe('HTML printing', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  const prepared = useFixture(() => {
    const userAgent = createManualUserAgent();
    const traversable = TopLevelTraversable.create(userAgent, null, '');
    const document = traversable.activeDocument!;
    const window = traversable.activeWindow!;
    const env = window.env;
    return {
      userAgent, traversable, document, window, env, loop: env.responsibleEventLoop,
      host: vi.spyOn(userAgent, 'obtainPhysicalForm').mockImplementation(() => {}),
    };
  });

  it('exposes print with no arguments', () => {
    const descriptor = Object.getOwnPropertyDescriptor(prepared().env.realm.windowProxy.platform, 'print');
    const method: unknown = descriptor?.value;
    expect(typeof method).toBe('function');
    expect(typeof method === 'function' ? method.length : null).toBe(0);
    expect(descriptor).toMatchObject({ writable: true, enumerable: true, configurable: true });
  });

  it('ignores extra arguments and rejects a non-Window receiver', () => runInHostTask(() => {
    const { env, loop, host } = prepared();
    const platform = env.realm.windowProxy.platform;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Reflect.apply supplies the receiver under test
    const print = platform.print;
    loop.runScriptEvaluation(env, () => {
      expect(Reflect.apply(print, platform, [{ toString() { throw new Error('Converted unused argument'); } }])).toBeUndefined();
      expect(() => Reflect.apply(print, {}, [])).toThrow();
    });
    expect(host).toHaveBeenCalledOnce();
  }));

  it('fires trusted Window events around the paused host, preserving beforeprint changes', () => runInHostTask(() => {
    const { document, env, loop, host } = prepared();
    const platform = env.realm.windowProxy.platform;
    const order: string[] = [];
    for (const type of ['beforeprint', 'afterprint']) {
      platform.addEventListener(type, (event) => {
        expect(event).toBeInstanceOf(platform.Event);
        expect(event.target).toBe(platform);
        expect([event.isTrusted, event.bubbles, event.cancelable, event.composed]).toEqual([true, false, false, false]);
        event.preventDefault();
        expect(event.defaultPrevented).toBe(false);
        order.push(type);
        if (type === 'beforeprint') document.body!.setAttribute('data-print', 'prepared');
        else document.body!.removeAttribute('data-print');
      });
    }
    host.mockImplementation((received) => {
      expect(received).toBe(document);
      expect(document.body!.getAttribute('data-print')).toBe('prepared');
      order.push('host');
      loop.queueTask(domManipulationTaskSource, null, { run: () => { order.push('task'); } });
      loop.queueMicrotask(() => { order.push('microtask'); });
      expect(loop.runTaskTurn()).toBe(false);
      loop.performMicrotaskCheckpoint();
      expect(order).toEqual(['beforeprint', 'host']);
    });
    loop.runScriptEvaluation(env, () => {
      expect(platform.print()).toBeUndefined();
      order.push('returned');
      expect(order).toEqual(['beforeprint', 'host', 'afterprint', 'returned']);
    });
    expect(document.body!.hasAttribute('data-print')).toBe(false);
    while (loop.runTaskTurn()) { /* Deliver the work queued during the host pause. */ }
    expect(order).toEqual(['beforeprint', 'host', 'afterprint', 'returned', 'microtask', 'task']);
  }));

  it.each(['sandbox', 'inactive', 'unloading'] as const)('suppresses printing for a %s Document without events', (reason) => {
    const { document, traversable, window, env, host } = prepared();
    const events = recordEvents(window, 'root');
    if (reason === 'sandbox') document.activeSandboxingFlagSet.add('sandboxed-modals');
    else if (reason === 'unloading') document.unloadCounter = 1;
    else traversable.activeSessionHistoryEntry = env.createSessionHistoryEntry(document.url, new DocumentState());
    window.print();
    expect(events).toEqual([]);
    expect(host).not.toHaveBeenCalled();
    expect(document.printWhenLoaded).toBe(false);
  });

  it.each(['inactive', 'unloading'] as const)('rechecks %s after beforeprint', (reason) => runInHostTask(() => {
    const { document, traversable, window, env, loop, host } = prepared();
    const events = recordEvents(window, 'root');
    env.realm.windowProxy.platform.onbeforeprint = () => {
      if (reason === 'unloading') document.unloadCounter = 1;
      else traversable.activeSessionHistoryEntry = env.createSessionHistoryEntry(document.url, new DocumentState());
    };
    loop.runScriptEvaluation(env, () => { window.print(); });
    expect(host).not.toHaveBeenCalled();
    expect(events).toEqual(['root:beforeprint']);
  }));

  it('coalesces pending requests and prints after the existing load work', () => runInHostTask(() => {
    const { document, window, env, loop, host } = prepared();
    const events = recordEvents(window, 'root');
    env.realm.windowProxy.platform.onload = () => { events.push('load'); };
    document.readyForPostLoadTasks = false;
    loop.runScriptEvaluation(env, () => {
      window.print();
      window.print();
      expect(document.printWhenLoaded).toBe(true);
      expect(host).not.toHaveBeenCalled();
      expect(events).toEqual([]);
      document.finishLoading();
    });
    expect(events).toEqual(['load']);
    expect(host).not.toHaveBeenCalled();
    expect(document.printWhenLoaded).toBe(true);
    while (loop.runTaskTurn()) { /* Deliver the deferred printing task. */ }
    expect(document.printWhenLoaded).toBe(false);
    expect(document.readyForPostLoadTasks).toBe(true);
    expect(host).toHaveBeenCalledExactlyOnceWith(document);
    expect(events).toEqual(['load', 'root:beforeprint', 'root:afterprint']);
  }));

  it('consumes the pending request when a load listener prints the ready Document', () => runInHostTask(() => {
    const { document, window, env, loop, host } = prepared();
    document.readyForPostLoadTasks = false;
    env.realm.windowProxy.platform.onload = () => { window.print(); };
    loop.runScriptEvaluation(env, () => { window.print(); document.finishLoading(); });
    expect(document.printWhenLoaded).toBe(false);
    expect(host).toHaveBeenCalledOnce();
  }));

  it('lets a ready print consume a request before its deferred task runs', () => runInHostTask(() => {
    const { document, window, env, loop, host } = prepared();
    document.readyForPostLoadTasks = false;
    loop.runScriptEvaluation(env, () => { window.print(); document.finishLoading(); window.print(); });
    expect(document.printWhenLoaded).toBe(false);
    expect(host).toHaveBeenCalledOnce();
    while (loop.runTaskTurn()) { /* The pending task must not print again. */ }
    expect(host).toHaveBeenCalledOnce();
  }));

  it('clears the pending flag when the Document task is discarded', () => runInHostTask(() => {
    const { document, window, env, loop, host } = prepared();
    document.readyForPostLoadTasks = false;
    loop.runScriptEvaluation(env, () => { window.print(); document.finishLoading(); });
    expect(document.printWhenLoaded).toBe(true);
    loop.removeTasksForDocument(document);
    expect(document.printWhenLoaded).toBe(false);
    expect(host).not.toHaveBeenCalled();
  }));

  it.each(['sandbox', 'unloading'] as const)('rechecks %s and clears a deferred request', (reason) => runInHostTask(() => {
    const { document, window, env, loop, host } = prepared();
    document.readyForPostLoadTasks = false;
    env.realm.windowProxy.platform.onload = () => {
      if (reason === 'sandbox') document.activeSandboxingFlagSet.add('sandboxed-modals');
      else document.unloadCounter = 1;
    };
    const events = recordEvents(window, 'root');
    loop.runScriptEvaluation(env, () => { window.print(); document.finishLoading(); });
    while (loop.runTaskTurn()) { /* Recheck admission when the deferred task runs. */ }
    expect(document.printWhenLoaded).toBe(false);
    expect(host).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  }));

  it('visits the requested Document and all descendants in tree order', () => runInHostTask(() => {
    const { document, window, env, loop } = prepared();
    const child = addChild(document);
    const grandchild = addChild(child.document);
    const sibling = addChild(document, false);
    // Sandbox gating belongs to the requested Document, not each descendant's event delivery.
    child.document.activeSandboxingFlagSet.add('sandboxed-modals');
    const events = recordEvents(window, 'root');
    recordEvents(child.window, 'child', events);
    recordEvents(grandchild.window, 'grandchild', events);
    recordEvents(sibling.window, 'foreign sibling', events);
    loop.runScriptEvaluation(env, () => { window.print(); });
    expect(events).toEqual([
      'root:beforeprint', 'child:beforeprint', 'grandchild:beforeprint', 'foreign sibling:beforeprint',
      'root:afterprint', 'child:afterprint', 'grandchild:afterprint', 'foreign sibling:afterprint',
    ]);
  }));

  it('prints a child subtree without notifying its ancestors or siblings', () => runInHostTask(() => {
    const { document, window, host } = prepared();
    const child = addChild(document);
    const grandchild = addChild(child.document);
    const sibling = addChild(document);
    const events = recordEvents(window, 'root');
    recordEvents(child.window, 'child', events);
    recordEvents(grandchild.window, 'grandchild', events);
    recordEvents(sibling.window, 'sibling', events);
    child.window.env.responsibleEventLoop.runScriptEvaluation(child.window.env, () => { child.window.print(); });
    expect(events).toEqual(['child:beforeprint', 'grandchild:beforeprint', 'child:afterprint', 'grandchild:afterprint']);
    expect(host).toHaveBeenCalledExactlyOnceWith(child.document);
  }));

  it('skips removed descendants and takes a fresh snapshot for afterprint', () => runInHostTask(() => {
    const { document, window, env, loop } = prepared();
    const child = addChild(document);
    const grandchild = addChild(child.document);
    const sibling = addChild(document);
    const events = recordEvents(window, 'root');
    recordEvents(child.window, 'removed', events);
    recordEvents(grandchild.window, 'removed grandchild', events);
    recordEvents(sibling.window, 'sibling', events);
    env.realm.windowProxy.platform.onbeforeprint = () => {
      child.container.remove();
      recordEvents(addChild(document).window, 'added', events);
    };
    loop.runScriptEvaluation(env, () => { window.print(); });
    expect(events).toEqual(['root:beforeprint', 'sibling:beforeprint', 'root:afterprint', 'sibling:afterprint', 'added:afterprint']);
  }));

  it('skips a replaced child Document selected before the parent listener', () => runInHostTask(() => {
    const { document, window, env, loop } = prepared();
    const child = addChild(document);
    const events = recordEvents(window, 'root');
    recordEvents(child.window, 'old', events);
    env.realm.windowProxy.platform.onbeforeprint = () => {
      const [, replacement] = BrowsingContext.create(document, child.container, document.browsingContext!.group!);
      child.container.contentNavigable = new Navigable(DocumentState.create(replacement), document.getNodeNavigable());
      recordEvents(replacement.getRelevantGlobalObject()!, 'replacement', events);
    };
    loop.runScriptEvaluation(env, () => { window.print(); });
    expect(events).toEqual(['root:beforeprint', 'root:afterprint', 'replacement:afterprint']);
  }));

  it('abandons a child print when beforeprint removes its embedding frame', () => runInHostTask(() => {
    const { document, host } = prepared();
    const child = addChild(document);
    const events = recordEvents(child.window, 'child');
    child.window.env.realm.windowProxy.platform.onbeforeprint = () => { child.container.remove(); };
    const env = child.window.env;
    env.responsibleEventLoop.runScriptEvaluation(env, () => { child.window.print(); });
    expect(events).toEqual(['child:beforeprint']);
    expect(host).not.toHaveBeenCalled();
  }));

  it('suppresses recursive printing during either event and the host, then permits another request', () => runInHostTask(() => {
    const { document, window, env, loop, host } = prepared();
    const child = addChild(document);
    const events = recordEvents(window, 'root');
    env.realm.windowProxy.platform.onbeforeprint = () => { window.print(); child.window.print(); };
    env.realm.windowProxy.platform.onafterprint = () => { window.print(); };
    host.mockImplementation(() => { window.print(); });
    loop.runScriptEvaluation(env, () => { window.print(); window.print(); });
    expect(host).toHaveBeenCalledTimes(2);
    expect(events).toEqual(['root:beforeprint', 'root:afterprint', 'root:beforeprint', 'root:afterprint']);
  }));

  it('restores printing and pause state after host failure without reporting afterprint', () => runInHostTask(() => {
    const { window, env, loop, host } = prepared();
    const events = recordEvents(window, 'root');
    const failure = new Error('print host failed');
    host.mockImplementationOnce(() => { throw failure; });
    loop.runScriptEvaluation(env, () => { expect(() => window.print()).toThrow(failure); });
    expect(events).toEqual(['root:beforeprint']);
    loop.runScriptEvaluation(env, () => { window.print(); });
    expect(events).toEqual(['root:beforeprint', 'root:beforeprint', 'root:afterprint']);
    let ran = false;
    loop.queueTask(domManipulationTaskSource, null, { run: () => { ran = true; } });
    expect(loop.runTaskTurn()).toBe(true);
    expect(ran).toBe(true);
  }));

  it('keeps capture, print layout, and UI as an explicit unfinished dependency', () => runInHostTask(() => {
    const { window, env, loop, host } = prepared();
    host.mockRestore();
    const events = recordEvents(window, 'root');
    loop.runScriptEvaluation(env, () => {
      expect(() => window.print()).toThrow('Physical-form capture, print layout, and print UI are not implemented');
    });
    expect(events).toEqual(['root:beforeprint']);
  }));
});

describe('printing through document loading', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  const prepared = useFixture(() => {
    const browser = new Browlet({
      route: () => `<!doctype html><script>
        window.printOrder = [];
        onbeforeprint = () => printOrder.push('beforeprint');
        onafterprint = () => printOrder.push('afterprint');
        onload = () => printOrder.push('load');
        print(); print();
        printOrder.push('requested');
      </script>`,
    });
    const userAgent = unwrap<DocumentImpl>(browser.document).env.userAgent;
    const host = vi.spyOn(userAgent, 'obtainPhysicalForm').mockImplementation(() => {});
    return { browser, host };
  });

  it('delivers one deferred print from the routed parser into the loading checkpoint', async () => {
    const { browser, host } = prepared();
    await browser.navigate('https://printing.test/page');
    expect(await browser.evaluate(async () => {
      const order = Reflect.get(window, 'printOrder') as string[];
      if (!order.includes('afterprint')) {
        await new Promise<void>((resolve) => { addEventListener('afterprint', () => { resolve(); }, { once: true }); });
      }
      return order;
    })).toEqual(['requested', 'load', 'beforeprint', 'afterprint']);
    expect(host).toHaveBeenCalledExactlyOnceWith(unwrap<DocumentImpl>(browser.document));
  });
});

function recordEvents(window: WindowImpl, label: string, events: string[] = []): string[] {
  const platform = window.env.realm.windowProxy.platform;
  platform.addEventListener('beforeprint', () => { events.push(`${label}:beforeprint`); });
  platform.addEventListener('afterprint', () => { events.push(`${label}:afterprint`); });
  return events;
}

function addChild(parent: DocumentImpl, inheritOrigin = true) {
  const container = parent.createElement('iframe') as HTMLIFrameElementImpl;
  parent.body!.appendChild(container);
  const group = parent.browsingContext!.topLevelBrowsingContext!.group!;
  const [, document] = BrowsingContext.create(inheritOrigin ? parent : null, container, group);
  container.contentNavigable = new Navigable(DocumentState.create(document), parent.getNodeNavigable());
  return { container, document, window: document.getRelevantGlobalObject()! };
}
