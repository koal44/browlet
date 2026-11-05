import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Document, Element, HTMLElement, WheelEvent, Window } from '../../../../src/browlet/platform';
import { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/index';
import type { DocumentImpl, ElementImpl } from '../../../../src/browlet/dom/nodes/index';
import { EventModifierState } from '../../../../src/browlet/interaction/events/index';
import type { WheelInput } from '../../../../src/browlet/interaction/wheel/index';
import { userInteractionTaskSource } from '../../../../src/browlet/scripting/index';
import { UnsafeMoment } from '../../../../src/browlet/timing/index';
import { createManualUserAgent } from '../../../support/browlet-agent';
import { getRelevantRealm, project, unwrap } from '../../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('Pointer Events §12: wheel input', () => {
  it('queues private receipt data and delivers a trusted WheelEvent through the real task and binding path', () => {
    const { input, document, loop, a, window, received, apply } = createFixture();
    const action = wheelInput();
    const stamp = vi.spyOn(getRelevantRealm(a), 'eventTimeStamp').mockReturnValue(125);
    input.queue(action);
    action.deltaY = 999;
    action.clientX = 999;
    action.buttons = 0;
    expect(received).toEqual([]);
    expect([...loop.getTaskQueue(userInteractionTaskSource)]).toHaveLength(1);
    expect(loop.runTaskTurn()).toBe(true);
    const event = received[0]!;
    expect(event).toBeInstanceOf(window.WheelEvent);
    expect(event.target).toBe(a);
    expect(event.view).toBe(window);
    const {
      type, isTrusted, bubbles, cancelable, composed, screenX, screenY, clientX, clientY,
      movementX, movementY, button, buttons, which, detail, relatedTarget, altKey,
      deltaX, deltaY, deltaZ, deltaMode, momentum, timeStamp,
    } = event;
    expect({
      type, isTrusted, bubbles, cancelable, composed, screenX, screenY, clientX, clientY,
      movementX, movementY, button, buttons, which, detail, relatedTarget, altKey,
      deltaX, deltaY, deltaZ, deltaMode, momentum, timeStamp,
    }).toEqual({
      type: 'wheel', isTrusted: true, bubbles: true, cancelable: false, composed: true,
      screenX: 12, screenY: -13, clientX: 4, clientY: -6, movementX: 0, movementY: 0,
      button: 0, buttons: 5, which: 1, detail: 0, relatedTarget: null, altKey: true,
      deltaX: 12.5, deltaY: -28.25, deltaZ: 1.5, deltaMode: 0, momentum: false, timeStamp: 125,
    });
    expect(stamp).toHaveBeenLastCalledWith(expect.any(UnsafeMoment));
    expect(apply).toHaveBeenCalledWith(unwrap<ElementImpl>(a), expect.objectContaining({ deltaY: -28.25, clientX: 4.75, buttons: 5 }));
    expect(document.wheelInput).toBe(input);
    expect(loop.runTaskTurn()).toBe(false);
  });

  it('retains the initial target across continuing and momentum updates and starts fresh on a new gesture', () => {
    const { input, loop, a, b, hitTest, received } = createFixture();
    input.queue(wheelInput());
    loop.runTaskTurn();
    hitTest.mockReturnValue(unwrap<ElementImpl>(b));
    input.queue({ ...wheelInput(false), clientX: 100 });
    input.queue({ ...wheelInput(false), momentum: true });
    loop.runTaskTurn();
    loop.runTaskTurn();
    expect(received.map((event) => event.target)).toEqual([a, a, a]);
    expect(hitTest).toHaveBeenCalledTimes(1);
    expect(received[2]!.momentum).toBe(true);
    input.queue(wheelInput());
    loop.runTaskTurn();
    expect(received.at(-1)!.target).toBe(b);
    expect(hitTest).toHaveBeenCalledTimes(2);
  });

  it('orders explicit gesture-end notifications without emitting an extra event or dropping later input', () => {
    const { input, loop, a, b, hitTest, received } = createFixture();
    input.queue(wheelInput());
    input.queueEnd();
    input.queue(wheelInput(false));
    loop.runTaskTurn();
    hitTest.mockReturnValue(unwrap<ElementImpl>(b));
    loop.runTaskTurn();
    expect(received.map((event) => event.target)).toEqual([a]);
    loop.runTaskTurn();
    expect(received.map((event) => event.target)).toEqual([a, b]);
  });

  it('blocks the default action after cancellation without canceling later updates of the gesture', () => {
    const { input, loop, a, b, hitTest, received, apply } = createFixture();
    a.addEventListener('wheel', (event) => { event.preventDefault(); }, { once: true, passive: false });
    input.queue(wheelInput());
    loop.runTaskTurn();
    expect(received[0]).toMatchObject({ cancelable: true, defaultPrevented: true });
    expect(apply).not.toHaveBeenCalled();
    hitTest.mockReturnValue(unwrap<ElementImpl>(b));
    input.queue(wheelInput(false));
    loop.runTaskTurn();
    expect(received[1]).toMatchObject({ target: a, cancelable: false, defaultPrevented: false });
    expect(apply).toHaveBeenCalledOnce();
  });

  it('observes root passive defaults and ignores non-passive listeners outside the actual path', () => {
    const { input, loop, b, window, received } = createFixture();
    window.addEventListener('wheel', (event) => { event.preventDefault(); });
    b.addEventListener('wheel', (event) => { event.preventDefault(); }, { passive: false });
    input.queue(wheelInput());
    loop.runTaskTurn();
    expect(received[0]).toMatchObject({ cancelable: false, defaultPrevented: false });
    window.addEventListener('wheel', (event) => { event.preventDefault(); }, { once: true, passive: false });
    input.queue(wheelInput(false));
    loop.runTaskTurn();
    expect(received[1]).toMatchObject({ cancelable: true, defaultPrevented: true });
  });

  it('observes aborted registrations and handlers at delivery rather than at input receipt', () => {
    const { input, loop, a, window, received, apply } = createFixture();
    const controller = new window.AbortController();
    a.addEventListener('wheel', (event) => { event.preventDefault(); }, { passive: false, signal: controller.signal });
    input.queue(wheelInput());
    controller.abort();
    loop.runTaskTurn();
    expect(received[0]!.cancelable).toBe(false);
    input.queue(wheelInput(false));
    a.onwheel = () => false;
    loop.runTaskTurn();
    expect(received[1]).toMatchObject({ cancelable: true, defaultPrevented: true });
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('observes slot and shadow-root listeners on DOM’s completed composed path', () => {
    const { input, document, loop, a, window, hitTest, apply } = createFixture();
    const platformDocument = project(document) as Document;
    const shadow = a.attachShadow({ mode: 'open' });
    const slot = platformDocument.createElement('slot');
    shadow.appendChild(slot);
    const child = platformDocument.createElement('span');
    a.appendChild(child);
    const trace: unknown[][] = [];
    slot.addEventListener('wheel', (event) => {
      trace.push(['slot', event.target === child, (event as WheelEvent).relatedTarget, event.cancelable]);
      event.preventDefault();
    }, { passive: false });
    window.addEventListener('wheel', (event) => {
      trace.push(['window', event.target === child, event.composed, event.defaultPrevented]);
    }, { passive: true });
    hitTest.mockReturnValue(unwrap<ElementImpl>(child));
    input.queue(wheelInput());
    loop.runTaskTurn();
    expect(trace).toEqual([['slot', true, null, true], ['window', true, true, true]]);
    expect(apply).not.toHaveBeenCalled();
  });

  it('retargets an inner shadow target normally without treating the pointer position as relatedTarget', () => {
    const { input, document, loop, a, window, hitTest, apply } = createFixture();
    const shadow = a.attachShadow({ mode: 'closed' });
    const inner = (project(document) as Document).createElement('span');
    shadow.appendChild(inner);
    const trace: unknown[][] = [];
    inner.addEventListener('wheel', (event) => {
      trace.push(['inner', event.target === inner, (event as WheelEvent).relatedTarget, event.cancelable]);
    }, { passive: true });
    window.addEventListener('wheel', (event) => {
      trace.push(['window', event.target === a, (event as WheelEvent).relatedTarget, event.cancelable]);
      event.preventDefault();
    }, { passive: false });
    hitTest.mockReturnValue(unwrap<ElementImpl>(inner));
    input.queue(wheelInput());
    loop.runTaskTurn();
    expect(trace).toEqual([['inner', true, null, true], ['window', true, null, true]]);
    expect(apply).not.toHaveBeenCalled();
  });

  it.each([false, true])('ends target retention when its subtree is removed (reinsert: %s)', (reinsert) => {
    const { input, document, loop, root, a, b, hitTest, received } = createFixture();
    const inner = (project(document) as Document).createElement('span');
    a.attachShadow({ mode: 'open' }).appendChild(inner);
    hitTest.mockReturnValue(unwrap<ElementImpl>(inner));
    input.queue(wheelInput());
    loop.runTaskTurn();
    a.remove();
    if (reinsert) root.appendChild(a);
    hitTest.mockReturnValue(unwrap<ElementImpl>(b));
    input.queue(wheelInput(false));
    loop.runTaskTurn();
    expect(received.at(-1)!.target).toBe(b);
    expect(hitTest).toHaveBeenCalledTimes(2);
  });

  it('preserves a transaction through a state-preserving move', () => {
    const { input, loop, root, a, b, hitTest, received } = createFixture();
    input.queue(wheelInput());
    loop.runTaskTurn();
    root.moveBefore(a, null);
    hitTest.mockReturnValue(unwrap<ElementImpl>(b));
    input.queue(wheelInput(false));
    loop.runTaskTurn();
    expect(received.map((event) => event.target)).toEqual([a, a]);
    expect(hitTest).toHaveBeenCalledTimes(1);
  });

  it('keeps Document transactions independent even within the same UserAgent', () => {
    const first = createFixture();
    const second = createFixture(first.userAgent);
    first.input.queue(wheelInput());
    second.input.queue(wheelInput());
    second.loop.runTaskTurn();
    first.loop.runTaskTurn();
    expect(first.received[0]!.target).toBe(first.a);
    expect(second.received[0]!.target).toBe(second.a);
    expect(first.input).not.toBe(second.input);
  });

  it('allocates at an adopted target’s creation realm and supplies the receiving Document’s view', () => {
    const first = createFixture();
    const second = createFixture(first.userAgent);
    second.root.appendChild(second.platformDocument.adoptNode(first.a));
    second.hitTest.mockReturnValue(unwrap<ElementImpl>(first.a));
    const origin = getRelevantRealm(first.a);
    const stamp = vi.spyOn(origin, 'eventTimeStamp').mockReturnValue(125);
    second.input.queue(wheelInput());
    second.loop.runTaskTurn();
    const event = second.received[0]!;
    expect(getRelevantRealm(event)).toBe(origin);
    expect(event.view).toBe(second.window);
    expect(event.timeStamp).toBe(125);
    expect(stamp).toHaveBeenLastCalledWith(expect.any(UnsafeMoment));
  });

  it('keeps default-action input separate from the author-visible event', () => {
    const { input, loop, a, apply } = createFixture();
    a.addEventListener('wheel', (event) => {
      Object.defineProperty(event, 'deltaY', { value: 999 });
      Object.defineProperty(event, 'deltaMode', { value: 2 });
    }, { passive: true });
    input.queue(wheelInput());
    loop.runTaskTurn();
    expect(apply).toHaveBeenCalledWith(unwrap<ElementImpl>(a), expect.objectContaining({ deltaY: -28.25, deltaMode: 0 }));
  });

  it('uses a locked target without layout hit testing', () => {
    const { input, loop, b, locked, hitTest, received } = createFixture();
    locked.mockReturnValue(unwrap<ElementImpl>(b));
    input.queue(wheelInput());
    loop.runTaskTurn();
    expect(received[0]!.target).toBe(b);
    expect(hitTest).not.toHaveBeenCalled();
  });

  it('handles an absent hit without inventing a Document or body target', () => {
    const { input, loop, b, hitTest, received, apply } = createFixture();
    hitTest.mockReturnValue(null);
    input.queue(wheelInput());
    loop.runTaskTurn();
    expect(received).toEqual([]);
    expect(apply).not.toHaveBeenCalled();
    hitTest.mockReturnValue(unwrap<ElementImpl>(b));
    input.queue(wheelInput(false));
    loop.runTaskTurn();
    expect(received[0]!.target).toBe(b);
  });

  it('rejects an unrouted target belonging to another Document', () => {
    const first = createFixture();
    const second = createFixture(first.userAgent);
    first.hitTest.mockReturnValue(unwrap<ElementImpl>(second.a));
    first.input.queue(wheelInput());
    expect(() => first.loop.runTaskTurn()).toThrow(/routing into its receiving Document/);
    expect(first.received).toEqual([]);
    expect(second.received).toEqual([]);
  });

  it('drops queued input and retained targets on inactivity, even after reactivation', () => {
    const { input, document, loop, b, hitTest, received } = createFixture();
    input.queue(wheelInput());
    loop.runTaskTurn();
    input.queue(wheelInput(false));
    const active = vi.spyOn(document, 'isFullyActive').mockReturnValue(false);
    document.notifyFullyActiveStateChanged();
    expect(() => input.queue(wheelInput())).toThrow(/fully active Document/);
    active.mockReturnValue(true);
    document.notifyFullyActiveStateChanged();
    loop.runTaskTurn();
    expect(received).toHaveLength(1);
    hitTest.mockReturnValue(unwrap<ElementImpl>(b));
    input.queue(wheelInput(false));
    loop.runTaskTurn();
    expect(received.at(-1)!.target).toBe(b);
  });

  it('removes queued wheel work and releases state during real Document destruction', () => {
    const { input, document, loop, received } = createFixture();
    input.queue(wheelInput());
    loop.runTaskTurn();
    const clear = vi.spyOn(input, 'clear');
    document.env.realm.queueGlobalTask(userInteractionTaskSource, () => { document.destroy(); });
    input.queue(wheelInput(false));
    loop.runTaskTurn();
    expect(clear).toHaveBeenCalled();
    expect(loop.runTaskTurn()).toBe(false);
    expect(received).toHaveLength(1);
    expect(() => input.queue(wheelInput())).toThrow(/live, fully active Document/);
  });

  it('drops input after its top-level destination has been unregistered', () => {
    const { input, loop, userAgent, traversable, received, apply } = createFixture();
    input.queue(wheelInput());
    userAgent.removeTopLevelTraversable(traversable);
    loop.runTaskTurn();
    expect(received).toEqual([]);
    expect(apply).not.toHaveBeenCalled();
    expect(() => input.queueEnd()).toThrow(/live, fully active Document/);
  });

  it('leaves synthetic dispatch outside transaction state and native default actions', () => {
    const { input, loop, a, b, window, hitTest, received, apply } = createFixture();
    a.dispatchEvent(new window.WheelEvent('wheel', { deltaY: 1, bubbles: true }));
    expect(apply).not.toHaveBeenCalled();
    hitTest.mockReturnValue(unwrap<ElementImpl>(b));
    input.queue(wheelInput(false));
    loop.runTaskTurn();
    expect(received.map((event) => [event.target, event.isTrusted])).toEqual([[a, false], [b, true]]);
    expect(apply).toHaveBeenCalledOnce();
  });

  it('fails explicitly at the missing hit-testing and default-action owners', () => {
    const layout = createFixture();
    layout.hitTest.mockRestore();
    layout.input.queue(wheelInput());
    expect(() => layout.loop.runTaskTurn()).toThrow(/layout hit testing/);
    const action = createFixture();
    action.apply.mockRestore();
    action.input.queue(wheelInput());
    expect(() => action.loop.runTaskTurn()).toThrow(/scrolling or zooming/);
    action.a.addEventListener('wheel', (event) => { event.preventDefault(); }, { passive: false });
    action.input.queue(wheelInput(false));
    expect(() => action.loop.runTaskTurn()).not.toThrow();
  });
});

/** Real owner, bindings, tree, queue, and dispatch; only the unfinished owner effects are controlled. */
function createFixture(userAgent = createManualUserAgent()) {
  const traversable = TopLevelTraversable.create(userAgent, null, '');
  const document: DocumentImpl = traversable.activeDocument!;
  const platformDocument = project(document) as Document;
  const root: Element = platformDocument.documentElement ?? platformDocument.createElement('html');
  if (!root.isConnected) platformDocument.appendChild(root);
  const a = platformDocument.createElement('div') as HTMLElement;
  const b = platformDocument.createElement('div') as HTMLElement;
  root.append(a, b);
  const window = project(traversable.activeWindow!) as Window;
  const input = document.wheelInput;
  const hitTest = vi.spyOn(input, 'hitTest').mockReturnValue(unwrap<ElementImpl>(a));
  const locked = vi.spyOn(input, 'getLockedElement').mockReturnValue(null);
  const apply = vi.spyOn(input, 'applyDefaultAction').mockImplementation(() => {});
  const received: WheelEvent[] = [];
  window.addEventListener('wheel', (event) => { received.push(event as WheelEvent); }, { passive: true });
  return {
    userAgent, traversable, document, platformDocument, root, a, b, window, input, hitTest, locked, apply, received,
    loop: document.env.realm.agent.eventLoop,
  };
}

function wheelInput(startsTransaction = true): WheelInput {
  return {
    startsTransaction, deltaX: 12.5, deltaY: -28.25, deltaZ: 1.5, deltaMode: 0, momentum: false,
    screenX: 12.75, screenY: -12.75, clientX: 4.75, clientY: -5.25, buttons: 5,
    modifiers: new EventModifierState({ modifierAltGraph: true }),
  };
}
