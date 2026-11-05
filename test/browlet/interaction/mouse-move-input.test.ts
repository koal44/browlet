import { setImmediate } from 'node:timers/promises';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { Element, MouseEvent, PointerEvent } from '../../../src/browlet/platform';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/index';
import type { DocumentImpl, NodeImpl } from '../../../src/browlet/dom/nodes/index';
import { PointerButton, type MouseInput, type MouseButtonInput } from '../../../src/browlet/interaction/index';
import { EventModifierState } from '../../../src/browlet/interaction/events/index';
import { userInteractionTaskSource } from '../../../src/browlet/scripting/index';
import { monotonicClock, UnsafeMoment } from '../../../src/browlet/timing/index';
import { mockEventLoopTurns } from '../../support/browlet-agent';
import { getRelevantRealm, project, unwrap } from '../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('Pointer Events §11.2.17: native mouse movement', () => {
  it.each([true, false])('queues a position snapshot with raw delivery restricted to secure=%s', async (secure) => {
    const { input, document, loop, a, window, events, hitTest, focus, activation } = await createFixture(secure);
    const move = moveInput(12.75, -12.75);
    input.queueMove(move, document);
    move.clientX = 999;
    move.screenY = 999;
    move.modifiers = new EventModifierState();
    expect(events).toEqual([]);
    const tasks = [...loop.getTaskQueue(userInteractionTaskSource)];
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.document).toBe(document);
    loop.runTaskTurn();
    expect(events.map((event) => event.type)).toEqual(secure ? ['pointerrawupdate', 'pointermove', 'mousemove'] : ['pointermove', 'mousemove']);
    expect(hitTest).toHaveBeenCalledTimes(secure ? 2 : 1);
    expect(hitTest).toHaveBeenCalledWith(document, 4.75, -5.25);
    expect(focus).not.toHaveBeenCalled();
    expect(activation).not.toHaveBeenCalled();
    for (const event of events) {
      expect(event).toMatchObject({
        target: a, view: window, isTrusted: true, bubbles: true, composed: true,
        cancelable: event.type !== 'pointerrawupdate', buttons: 0, detail: 0, movementX: 0, movementY: 0,
      });
      expect(event.getModifierState('AltGraph')).toBe(true);
      expect(event.getModifierState('Alt')).toBe(false);
      expect(event.altKey).toBe(true);
    }
    const pointer = events.find((event) => event.type === 'pointermove') as PointerEvent;
    expect(pointer).toMatchObject({
      screenX: 12.75, screenY: -12.75, clientX: 4.75, clientY: -5.25,
      button: -1, pointerId: 1, pointerType: 'mouse', isPrimary: true, pressure: 0,
    });
    expect(events.at(-1)).toMatchObject({ screenX: 12, screenY: -13, clientX: 4, clientY: -6, button: 0 });
    if (secure) expect(pointer.getCoalescedEvents()).toHaveLength(1);
    else expect('getCoalescedEvents' in pointer).toBe(false);
    expect(pointer.getPredictedEvents()).toEqual([]);
  });

  it.each([false, true])('repairs the pointer target at subtree removal (reinsert: %s)', async (reinsert) => {
    const { browser, document, input, loop, a, b, hitTest, traversable, window } = await createFixture();
    const child = browser.document.createElement('span');
    const parent = browser.document.body!;
    a.append(child);
    hitTest.mockReturnValue(unwrap<NodeImpl>(child));
    input.queueMove(moveInput(), document);
    loop.runTaskTurn();
    const stream = traversable.pointerEventStreams.get(1)!;
    a.remove();
    if (reinsert) parent.append(a);
    expect(stream.previousTarget === unwrap<NodeImpl>(parent)).toBe(true);
    expect(stream.needsOverEvent).toBe(true);
    const target = reinsert ? child : b;
    const boundaries: boolean[][] = [];
    window.addEventListener('pointerover', (event) => {
      boundaries.push([event.target === target, (event as PointerEvent).relatedTarget === parent]);
    });
    hitTest.mockReturnValue(unwrap<NodeImpl>(target));
    input.queueMove(moveInput(), document);
    loop.runTaskTurn();
    expect(boundaries).toEqual([[true, true]]);
    expect(stream.needsOverEvent).toBe(false);
  });

  it('keeps pointer boundaries unchanged through a state-preserving move', async () => {
    const { browser, document, input, loop, a, traversable, window } = await createFixture();
    input.queueMove(moveInput(), document);
    loop.runTaskTurn();
    const boundaries: string[] = [];
    for (const type of ['pointerover', 'pointerout']) window.addEventListener(type, () => boundaries.push(type));
    browser.document.body!.moveBefore(a, null);
    const stream = traversable.pointerEventStreams.get(1)!;
    expect(stream.previousTarget === unwrap<NodeImpl>(a)).toBe(true);
    expect(stream.needsOverEvent).toBe(false);
    input.queueMove(moveInput(), document);
    loop.runTaskTurn();
    expect(boundaries).toEqual([]);
  });

  it('updates motion once for each raw/pointer/mouse group', async () => {
    const { input, document, loop, events } = await createFixture();
    for (const move of [moveInput(10.9, -10.9), moveInput(14.1, -7.1), moveInput(14.9, -9.2)]) input.queueMove(move, document);
    for (let index = 0; index < 3; index++) loop.runTaskTurn();
    expect(events.map((event) => [event.movementX, event.movementY]))
      .toEqual([[0, 0], [0, 0], [0, 0], [4, 3], [4, 3], [4, 3], [0, -2], [0, -2], [0, -2]]);
  });

  it('keeps chronological movement and receipt-time buttons around a queued press/release', async () => {
    const { input, document, loop, a, events } = await createFixture();
    const order: string[] = [];
    for (const type of ['pointerrawupdate', 'pointermove', 'mousemove', 'pointerdown', 'pointerup', 'click']) {
      a.addEventListener(type, (event) => order.push(`${type}:${(event as MouseEvent).buttons}`));
    }
    input.queueMove(moveInput(), document);
    input.queueButton(buttonInput(true), document);
    input.queueMove(moveInput(20, 30), document);
    input.queueButton(buttonInput(false), document);
    input.queueMove(moveInput(25, 35), document);
    for (let index = 0; index < 5; index++) loop.runTaskTurn();
    expect(order).toEqual(['pointerrawupdate:0', 'pointermove:0', 'mousemove:0', 'pointerdown:1',
      'pointerrawupdate:1', 'pointermove:1', 'mousemove:1', 'pointerup:0', 'click:0',
      'pointerrawupdate:0', 'pointermove:0', 'mousemove:0']);
    expect(events.filter((event) => event.type === 'pointermove').map((event) => (event as PointerEvent).pressure)).toEqual([0, 0.5, 0]);
  });

  it('also delivers raw before the pointermoves caused by chorded button changes', async () => {
    const { input, document, loop, events } = await createFixture();
    input.queueButton(buttonInput(true), document);
    input.queueButton({ ...buttonInput(true), button: PointerButton.Auxiliary }, document);
    input.queueButton({ ...buttonInput(false), button: PointerButton.Auxiliary }, document);
    input.queueButton(buttonInput(false), document);
    for (let index = 0; index < 4; index++) loop.runTaskTurn();
    expect(events.map((event) => [event.type, event.buttons, event.button])).toEqual([
      ['pointerrawupdate', 5, 1], ['pointermove', 5, 1], ['pointerrawupdate', 1, 1], ['pointermove', 1, 1],
    ]);
    for (const event of events as PointerEvent[]) expect(event.getCoalescedEvents()).toHaveLength(1);
  });

  it('emits pointer boundaries once before raw, then mouse boundaries before the mapped move', async () => {
    const { input, document, loop, a, b, hitTest } = await createFixture();
    input.queueMove(moveInput(), document);
    loop.runTaskTurn();
    const order: string[] = [];
    for (const target of [a, b]) {
      for (const type of ['pointerout', 'pointerleave', 'pointerover', 'pointerenter', 'pointerrawupdate',
        'mouseout', 'mouseleave', 'mouseover', 'mouseenter', 'pointermove', 'mousemove']) {
        target.addEventListener(type, () => order.push(`${type}:${target.id}`));
      }
    }
    hitTest.mockReturnValue(unwrap(b));
    input.queueMove(moveInput(20, 30), document);
    loop.runTaskTurn();
    expect(order).toEqual(['pointerout:a', 'pointerleave:a', 'pointerover:b', 'pointerenter:b', 'pointerrawupdate:b',
      'mouseout:a', 'mouseleave:a', 'mouseover:b', 'mouseenter:b', 'pointermove:b', 'mousemove:b']);
  });

  it('follows §11.3 nested mouse order through the queued input producer', async () => {
    const { browser, input, document, loop, a, b, hitTest } = await createFixture(false);
    const c = browser.document.createElement('div');
    c.id = 'c';
    a.append(b);
    b.append(c);
    const observed: MouseEvent[] = [];
    for (const target of [a, b, c]) {
      for (const type of ['mouseover', 'mouseenter', 'mousemove', 'mouseout', 'mouseleave']) {
        target.addEventListener(type, (event) => {
          if (event.target === target) observed.push(event as MouseEvent);
        });
      }
    }
    // Start outside the nested stack, enter its deepest element, return to A, then exit.
    for (const [target, position] of [[browser.document.body!, 10], [c, 20], [a, 30], [browser.document.body!, 40]] as const) {
      hitTest.mockReturnValue(unwrap<NodeImpl>(target));
      input.queueMove(moveInput(position, 0), document);
      loop.runTaskTurn();
    }
    expect(observed.map((event) => `${event.type}:${(event.target as Element).id}`)).toEqual([
      'mouseover:c', 'mouseenter:a', 'mouseenter:b', 'mouseenter:c', 'mousemove:c',
      'mouseout:c', 'mouseleave:c', 'mouseleave:b', 'mouseover:a', 'mousemove:a',
      'mouseout:a', 'mouseleave:a',
    ]);
    for (const event of observed) {
      const propagates = event.type !== 'mouseenter' && event.type !== 'mouseleave';
      expect([event.bubbles, event.cancelable, event.composed]).toEqual([propagates, propagates, propagates]);
      expect([event.isTrusted, event.detail, event.button, event.buttons]).toEqual([true, 0, 0, 0]);
      expect(event).toBeInstanceOf(browser.window.MouseEvent);
      expect(event).not.toBeInstanceOf(browser.window.PointerEvent);
    }
  });

  it('supplies §11.4 mouse boundaries after layout without inventing a mousemove', async () => {
    const { input, document, loop, a, b, traversable, events } = await createFixture(false);
    input.queueMove(moveInput(), document);
    loop.runTaskTurn();
    events.length = 0;
    const order: string[] = [];
    for (const target of [a, b]) {
      for (const type of ['mouseout', 'mouseleave', 'mouseover', 'mouseenter']) {
        target.addEventListener(type, () => order.push(`${type}:${target.id}`));
      }
    }
    const stream = traversable.pointerEventStreams.get(1)!;
    // Layout still owns detecting the change and supplying the new hit-test result.
    stream.updateAfterLayout(() => unwrap<NodeImpl>(b), document.env.realm.eventTimeStamp());
    expect(order).toEqual(['mouseout:a', 'mouseleave:a', 'mouseover:b', 'mouseenter:b']);
    expect(events).toEqual([]);
  });

  it('processes capture changed by a raw listener before the corresponding move', async () => {
    const { input, document, loop, a, b, hitTest, events } = await createFixture();
    a.addEventListener('pointerdown', () => a.setPointerCapture(1));
    input.queueButton(buttonInput(true), document);
    loop.runTaskTurn();
    const notifications: string[] = [];
    for (const target of [a, b]) {
      for (const type of ['gotpointercapture', 'lostpointercapture']) target.addEventListener(type, () => notifications.push(`${type}:${target.id}`));
    }
    a.addEventListener('pointerrawupdate', () => b.setPointerCapture(1), { once: true });
    hitTest.mockClear();
    input.queueMove(moveInput(), document);
    loop.runTaskTurn();
    expect(events.map((event) => [event.type, (event.target as Element).id]))
      .toEqual([['pointerrawupdate', 'a'], ['pointermove', 'b'], ['mousemove', 'b']]);
    expect(notifications).toEqual(['gotpointercapture:a', 'lostpointercapture:a', 'gotpointercapture:b']);
    expect(hitTest).not.toHaveBeenCalled();
  });

  it('retains input after raw/pointer reinitialization and does not suppress mousemove on move cancellation', async () => {
    const { input, document, loop, a, events } = await createFixture();
    a.addEventListener('pointerrawupdate', (event) => {
      (event as MouseEvent).initMouseEvent('changed', false, false, null, 0, 0, 0, 999, 999, false, false, false, false, 0, null);
    });
    a.addEventListener('pointermove', (event) => {
      event.preventDefault();
      (event as MouseEvent).initMouseEvent('changed', false, false, null, 0, 0, 0, 888, 888, false, false, false, false, 0, null);
    });
    input.queueMove(moveInput(), document);
    loop.runTaskTurn();
    expect(events).toHaveLength(3);
    expect(events[1]!.defaultPrevented).toBe(true);
    expect(events[2]).toMatchObject({ type: 'mousemove', clientX: 4, clientY: -6, isTrusted: true });
    expect(events[2]!.getModifierState('AltGraph')).toBe(true);
  });

  it('advances native motion while canceled pointerdown suppresses compatibility movement', async () => {
    const { input, document, loop, a, events } = await createFixture();
    a.addEventListener('pointerdown', (event) => event.preventDefault());
    input.queueMove(moveInput(10, 10), document);
    input.queueButton(buttonInput(true), document);
    input.queueMove(moveInput(20, 30), document);
    input.queueButton(buttonInput(false), document);
    input.queueMove(moveInput(25, 33), document);
    for (let index = 0; index < 5; index++) loop.runTaskTurn();
    expect(events.filter((event) => event.type === 'mousemove').map((event) => [event.movementX, event.movementY]))
      .toEqual([[0, 0], [5, 3]]);
    expect(events.filter((event) => event.type === 'pointermove')).toHaveLength(3);
  });

  it('shares a receipt timestamp across raw, move, samples, and mouse despite delayed delivery', async () => {
    const { input, document, loop, a, events } = await createFixture();
    const receipt = new UnsafeMoment(monotonicClock, document.env.timeOrigin.milliseconds + 123.456);
    const clock = vi.spyOn(monotonicClock, 'unsafeCurrentTime').mockReturnValue(receipt);
    input.queueMove(moveInput(), document);
    clock.mockReturnValue(new UnsafeMoment(monotonicClock, receipt.milliseconds + 100));
    a.addEventListener('pointerrawupdate', () => clock.mockReturnValue(new UnsafeMoment(monotonicClock, receipt.milliseconds + 200)));
    loop.runTaskTurn();
    const expected = document.env.timing.relativeHighResolutionTime(receipt).toTimestamp();
    expect(events.map((event) => event.timeStamp)).toEqual([expected, expected, expected]);
    for (const event of events.slice(0, 2) as PointerEvent[]) {
      expect(event.getCoalescedEvents()[0]!.timeStamp).toBe(expected);
    }
  });

  it('maps the same reading to a different creation realm when a raw listener changes the target', async () => {
    const { browser, input, document, loop, a, window, events, hitTest } = await createFixture();
    const other = TopLevelTraversable.create(document.env.userAgent, null, '');
    const adopted = project(other.activeDocument!.createElement('div')) as Element;
    browser.document.body!.appendChild(browser.document.adoptNode(adopted));
    const origin = getRelevantRealm(adopted);
    for (const type of ['pointerrawupdate', 'pointermove', 'mousemove']) adopted.addEventListener(type, (event) => events.push(event as MouseEvent));
    const receivedAt: UnsafeMoment[] = [];
    vi.spyOn(origin, 'eventTimeStamp').mockImplementation((time) => {
      if (time !== undefined) receivedAt.push(time);
      return 125;
    });
    const receivingClock = vi.spyOn(document.env.realm, 'eventTimeStamp').mockReturnValue(875);
    a.addEventListener('pointerrawupdate', () => hitTest.mockReturnValue(unwrap(adopted)));
    input.queueMove(moveInput(30, 40), document);
    loop.runTaskTurn();
    expect(events.map((event) => event.timeStamp)).toEqual([875, 125, 125]);
    expect(getRelevantRealm(events[0]!)).toBe(document.env.realm);
    expect(events.slice(1).every((event) => getRelevantRealm(event) === origin)).toBe(true);
    expect(events.every((event) => event.view === window)).toBe(true);
    expect(receivedAt).toHaveLength(1);
    expect(receivedAt[0]).toBe(receivingClock.mock.calls.find(([time]) => time !== undefined)![0]);
    expect(other.activeWindow!.lastMouseMove).toBeUndefined();
    expect(document.getRelevantGlobalObject()!.lastMouseMove).toEqual({ x: 30, y: 40 });
    expect(loop.getTaskQueue(userInteractionTaskSource).size).toBe(0);
  });

  it('keeps synthetic motion out of native history', async () => {
    const { input, document, loop, a, window, events } = await createFixture();
    input.queueMove(moveInput(10, 10), document);
    loop.runTaskTurn();
    a.dispatchEvent(new window.MouseEvent('mousemove', { screenX: 999, screenY: 999, movementX: 987 }));
    input.queueMove(moveInput(13, 17), document);
    loop.runTaskTurn();
    expect(events.at(-1)).toMatchObject({ type: 'mousemove', movementX: 3, movementY: 7 });
  });

  it('drops queued input after its top-level destination is removed and rejects unrelated documents', async () => {
    const { input, document, loop, events, traversable } = await createFixture();
    input.queueMove(moveInput(), document);
    document.env.userAgent.removeTopLevelTraversable(traversable);
    loop.runTaskTurn();
    expect(events).toEqual([]);
    expect(traversable.pointerEventStreams.size).toBe(0);
    expect(() => input.queueMove(moveInput(), document)).toThrow(/live browsing context/);
    const other = new Browlet({ route: () => '' });
    expect(() => input.queueMove(moveInput(), unwrap(other.document))).toThrow(/live browsing context/);
  });

  it.each(['missing lock state', 'locked input', 'missing layout'])(
    'keeps %s explicit before movement delivery', async (dependency) => {
      const { input, document, loop, events, locked, hitTest } = await createFixture();
      if (dependency === 'missing lock state') locked.mockRestore();
      else if (dependency === 'locked input') locked.mockReturnValue(true);
      else hitTest.mockRestore();
      input.queueMove(moveInput(), document);
      expect(() => loop.runTaskTurn()).toThrow(dependency === 'missing layout' ? /layout hit testing/ : /Pointer Lock/);
      expect(events).toEqual([]);
    },
  );
});

/** Real navigation, task queues, bindings and listeners; only unfinished input owners are supplied. */
async function createFixture(secure = true) {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate(`${secure ? 'https' : 'http'}://mouse.test/`);
  // Stock Node can resume this await inside the navigation task's checkpoint.
  // Leave that host turn before manually advancing the same event loop.
  await setImmediate();
  const document = unwrap<DocumentImpl>(browser.document);
  const loop = document.env.realm.agent.eventLoop;
  while (loop.runTaskTurn()) { /* Finish navigation tasks before manually stepping input. */ }
  mockEventLoopTurns();
  const a = browser.document.createElement('div');
  const b = browser.document.createElement('div');
  a.id = 'a';
  b.id = 'b';
  browser.document.body!.append(a, b);
  const input = document.env.userAgent.mouseInput;
  const hitTest = vi.spyOn(input, 'hitTest').mockReturnValue(unwrap<NodeImpl>(a));
  const locked = vi.spyOn(input, 'hasLockedElement').mockReturnValue(false);
  const focus = vi.spyOn(input, 'focusOnMouseDown').mockImplementation(() => {});
  const activation = vi.spyOn(input, 'notifyUserActivation').mockImplementation(() => {});
  const events: MouseEvent[] = [];
  for (const target of [a, b]) {
    for (const type of ['pointerrawupdate', 'pointermove', 'mousemove']) target.addEventListener(type, (event) => events.push(event as MouseEvent));
  }
  return {
    browser, document, loop, a, b, input, events, hitTest, locked, focus, activation,
    window: browser.window, traversable: document.getNodeNavigable()!.topLevelTraversable,
  };
}

function moveInput(screenX = 10, screenY = 10): MouseInput {
  return { screenX, screenY, clientX: 4.75, clientY: -5.25, modifiers: new EventModifierState({ modifierAltGraph: true }) };
}

function buttonInput(pressed: boolean): MouseButtonInput {
  return { ...moveInput(), button: PointerButton.Primary, pressed, click: !pressed, doubleClick: false, contextMenu: false, clickCount: 1 };
}
