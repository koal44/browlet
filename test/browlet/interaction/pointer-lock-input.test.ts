import { setImmediate } from 'node:timers/promises';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { Element, MouseEvent, PointerEvent } from '../../../src/browlet/platform';
import type { DocumentImpl, ElementImpl } from '../../../src/browlet/dom/nodes/index';
import { PointerButton, type MouseButtonInput, type RelativeMouseInput, type WheelInput } from '../../../src/browlet/interaction/index';
import { EventModifierState } from '../../../src/browlet/interaction/events/index';
import { mockEventLoopTurns } from '../../support/browlet-agent';
import { unwrap } from '../../support/browlet-binding';
import { observeBrowletPromise } from '../test-runtime';

afterEach(() => { vi.restoreAllMocks(); });

describe('Pointer Lock §§2.1, 6–7: native locked input', () => {
  it.each([true, false])('delivers relative motion with frozen coordinates and secure=%s raw updates', async (secure) => {
    const f = await createFixture(secure);
    await f.lockTo(f.a);
    const action = relative(12.5, -4.25);
    f.input.queueRelativeMove(action);
    action.movementX = 999;
    action.modifiers = new EventModifierState();
    expect(f.events).toEqual([]);
    f.flush();
    expect(f.events.map((event) => event.type)).toEqual(secure ? ['pointerrawupdate', 'pointermove', 'mousemove'] : ['pointermove', 'mousemove']);
    expect(f.events.every((event) => event.target === f.a && event.isTrusted && event.view === f.browser.window)).toBe(true);
    expect(f.events.every((event) => event.movementX === 12.5 && event.movementY === -4.25 && event.altKey)).toBe(true);
    for (const event of f.events) {
      const pointer = event.type.startsWith('pointer');
      expect([event.screenX, event.screenY, event.clientX, event.clientY]).toEqual(pointer
        ? [25.5, -17.25, 3.75, -2.25] : [25, -18, 3, -3]);
    }
    expect(f.hitTest).not.toHaveBeenCalled();
    expect(f.mouseBoundaries).toEqual([]);
    expect(f.pointerBoundaries).toContain('pointerover:a');
    const move = f.events.find((event) => event.type === 'pointermove') as PointerEvent;
    if (secure) expect(move.getCoalescedEvents()[0]).toMatchObject({ movementX: 12.5, movementY: -4.25, target: f.a });
    else expect('getCoalescedEvents' in move).toBe(false);
  });

  it('retains large continuous deltas instead of deriving them from the frozen position', async () => {
    const f = await createFixture();
    await f.lockTo(f.a);
    f.input.queueRelativeMove(relative(10000.5, -12000.25));
    f.input.queueRelativeMove(relative(-9, 14));
    f.input.queueRelativeMove(relative(0, 0));
    f.flush();
    expect(f.events.filter((event) => event.type === 'mousemove').map((event) => [event.movementX, event.movementY]))
      .toEqual([[10000.5, -12000.25], [-9, 14], [0, 0]]);
    expect(f.events.every((event) => event.screenX === (event.type.startsWith('pointer') ? 25.5 : 25))).toBe(true);
    expect(f.document.getRelevantGlobalObject()!.lastMouseMove).toBeUndefined();
  });

  it('routes button, click, double-click, and wheel delivery to the locked target without hit testing', async () => {
    const f = await createFixture();
    await f.lockTo(f.a);
    f.input.queueButton(button(true), f.document);
    f.input.queueButton(button(false), f.document);
    f.input.queueButton({ ...button(true), clickCount: 2 }, f.document);
    f.input.queueButton({ ...button(false), clickCount: 2, doubleClick: true }, f.document);
    f.wheel.queue(wheel());
    f.flush();
    expect(f.events.map((event) => event.type)).toEqual([
      'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click',
      'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick', 'wheel',
    ]);
    expect(f.events.every((event) => event.target === f.a && event.movementX === 0 && event.movementY === 0)).toBe(true);
    expect(f.events.filter((event) => !event.type.startsWith('pointer')).every((event) =>
      event.screenX === 25 && event.screenY === -18 && event.clientX === 3 && event.clientY === -3)).toBe(true);
    expect(f.hitTest).not.toHaveBeenCalled();
    expect(f.wheelHit).not.toHaveBeenCalled();
    expect(f.applyWheel).toHaveBeenCalledWith(unwrap(f.a), expect.objectContaining({
      screenX: 25.5, clientX: 3.75, deltaY: 17,
    }));
    expect(f.mouseBoundaries).toEqual([]);
  });

  it('retains ordinary pointer cancellation and capture rejection while locked', async () => {
    const f = await createFixture();
    await f.lockTo(f.a);
    f.a.addEventListener('pointerdown', (event) => { event.preventDefault(); }, { once: true });
    f.input.queueButton(button(true), f.document);
    f.flush();
    expect(() => f.a.setPointerCapture(1)).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
    f.input.queueRelativeMove(relative(2, 3));
    f.input.queueButton(button(false), f.document);
    f.flush();
    expect(f.events.map((event) => event.type)).toEqual([
      'pointerdown', 'pointerrawupdate', 'pointermove', 'pointerup', 'click',
    ]);
    expect(f.mouseBoundaries).toEqual([]);
  });

  it('keeps the locked release target for click even if the press used another locked element', async () => {
    const f = await createFixture();
    await f.lockTo(f.a);
    f.input.queueButton(button(true), f.document);
    f.flush();
    await f.lockTo(f.b);
    f.input.queueButton(button(false), f.document);
    f.flush();
    expect(f.events.find((event) => event.type === 'click')?.target).toBe(f.b);
    expect(f.mouseBoundaries).toEqual([]);
    expect(f.pointerBoundaries).toContain('pointerout:a');
    expect(f.pointerBoundaries).toContain('pointerover:b');
    expect(f.acquire).toHaveBeenCalledOnce();
  });

  it('drops queued relative input after retargeting and after exit/reacquisition of the same target', async () => {
    const f = await createFixture();
    await f.lockTo(f.a);
    f.input.queueRelativeMove(relative(999, 999));
    await f.lockTo(f.b);
    expect(f.events).toEqual([]);
    f.input.queueRelativeMove(relative(888, 888));
    f.browser.document.exitPointerLock();
    await f.lockTo(f.b);
    expect(f.events).toEqual([]);
    f.input.queueRelativeMove(relative(4, 5));
    f.flush();
    expect(f.events.map((event) => event.movementX)).toEqual([4, 4, 4]);
    expect(f.events.every((event) => event.target === f.b)).toBe(true);
  });

  it('drops queued locked wheel input and stops a relative packet if its raw listener unlocks', async () => {
    const f = await createFixture();
    await f.lockTo(f.a);
    f.wheel.queue(wheel());
    f.browser.document.exitPointerLock();
    f.flush();
    expect(f.events).toEqual([]);
    await f.lockTo(f.a);
    f.a.addEventListener('pointerrawupdate', () => { f.browser.document.exitPointerLock(); }, { once: true });
    f.input.queueRelativeMove(relative(7, 8));
    f.flush();
    expect(f.events.map((event) => event.type)).toEqual(['pointerrawupdate']);
    expect(f.applyWheel).not.toHaveBeenCalled();
  });

  it('starts fresh absolute motion after unlock and rejects absolute input while locked', async () => {
    const f = await createFixture();
    const position = { screenX: 5, screenY: 6, clientX: 2, clientY: 3, modifiers: new EventModifierState() };
    f.input.queueMove(position, f.document);
    f.flush();
    await f.lockTo(f.a);
    f.events.length = 0;
    f.input.queueMove(position, f.document);
    expect(f.flush).toThrow(/native relative input/);
    f.input.queueRelativeMove(relative(900, 1000));
    f.flush();
    f.browser.document.exitPointerLock();
    f.flush();
    f.events.length = 0;
    f.input.queueMove({ ...position, screenX: 5000, screenY: -6000 }, f.document);
    f.flush();
    expect(f.events.every((event) => event.movementX === 0 && event.movementY === 0)).toBe(true);
    expect(() => f.input.queueRelativeMove(relative(1, 1))).toThrow(/requires pointer lock/);
  });

  it('does not retarget author-created mouse events or rewrite their coordinates', async () => {
    const f = await createFixture();
    await f.lockTo(f.a);
    f.b.dispatchEvent(new f.browser.window.MouseEvent('mousemove', { bubbles: true, clientX: 75, movementX: 33 }));
    expect(f.events).toHaveLength(1);
    expect(f.events[0]).toMatchObject({ target: f.b, isTrusted: false, clientX: 75, movementX: 33 });
    expect(f.document.getRelevantGlobalObject()!.lastMouseMove).toBeUndefined();
  });
});

/** Real navigation, tasks, bindings and lock state; only unfinished native/layout/HTML effects are controlled. */
async function createFixture(secure = true) {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate(`${secure ? 'https' : 'http'}://locked-input.test/`);
  await setImmediate();
  const document = unwrap<DocumentImpl>(browser.document);
  const loop = document.env.realm.agent.eventLoop;
  while (loop.runTaskTurn()) { /* Complete navigation before manually controlling input. */ }
  mockEventLoopTurns();
  const userAgent = document.env.userAgent;
  const a = browser.document.createElement('div');
  const b = browser.document.createElement('div');
  a.id = 'a'; b.id = 'b';
  browser.document.body!.append(a, b);
  const lock = userAgent.pointerLock;
  const parallel: (() => void)[] = [];
  vi.spyOn(userAgent, 'runInParallel').mockImplementation((steps) => { parallel.push(steps); });
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.spyOn(document.getRelevantGlobalObject()!, 'hasTransientActivation').mockReturnValue(true);
  vi.spyOn(lock, 'supportsUnadjustedMovement').mockReturnValue(true);
  const acquire = vi.spyOn(lock, 'acquire').mockReturnValue({ screenX: 25.5, screenY: -17.25, clientX: 3.75, clientY: -2.25 });
  vi.spyOn(lock, 'restoreCursor').mockImplementation(() => {});
  const input = userAgent.mouseInput;
  const hitTest = vi.spyOn(input, 'hitTest').mockReturnValue(unwrap<ElementImpl>(b));
  vi.spyOn(input, 'notifyUserActivation').mockImplementation(() => {});
  vi.spyOn(input, 'focusOnMouseDown').mockImplementation(() => {});
  const wheel = document.wheelInput;
  const wheelHit = vi.spyOn(wheel, 'hitTest').mockReturnValue(unwrap<ElementImpl>(b));
  const applyWheel = vi.spyOn(wheel, 'applyDefaultAction').mockImplementation(() => {});
  const events: MouseEvent[] = [];
  const mouseBoundaries: string[] = [];
  const pointerBoundaries: string[] = [];
  for (const type of ['pointerrawupdate', 'pointermove', 'pointerdown', 'pointerup',
    'mousemove', 'mousedown', 'mouseup', 'click', 'auxclick', 'dblclick', 'wheel']) {
    browser.window.addEventListener(type, (event) => { events.push(event as MouseEvent); });
  }
  for (const type of ['mouseover', 'mouseout', 'mouseenter', 'mouseleave']) {
    browser.document.addEventListener(type, (event) => { mouseBoundaries.push(type + ':' + (event.target as Element).id); }, true);
  }
  for (const type of ['pointerover', 'pointerout', 'pointerenter', 'pointerleave']) {
    browser.document.addEventListener(type, (event) => { pointerBoundaries.push(type + ':' + (event.target as Element).id); }, true);
  }
  const flush = () => { while (loop.runTaskTurn()) { /* Drain actual input and notification tasks. */ } };
  const lockTo = async (element: Element) => {
    const result = observeBrowletPromise(browser.window, element.requestPointerLock());
    while (parallel.length) parallel.shift()!();
    flush();
    await result;
  };
  return { browser, document, a, b, lock, acquire, input, hitTest, wheel, wheelHit, applyWheel, events, mouseBoundaries, pointerBoundaries, flush, lockTo };
}

function relative(movementX: number, movementY: number): RelativeMouseInput {
  return { movementX, movementY, modifiers: new EventModifierState({ altKey: true }) };
}

function button(pressed: boolean): MouseButtonInput {
  return {
    screenX: 999, screenY: 999, clientX: 555, clientY: 555, modifiers: new EventModifierState(),
    button: PointerButton.Primary, pressed, click: !pressed, doubleClick: false, contextMenu: false, clickCount: 1,
  };
}

function wheel(): WheelInput {
  return {
    screenX: 999, screenY: 999, clientX: 555, clientY: 555, modifiers: new EventModifierState(),
    buttons: 0, deltaX: 0, deltaY: 17, deltaZ: 0, deltaMode: 0, momentum: false, startsTransaction: true,
  };
}
