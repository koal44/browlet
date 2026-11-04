import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Document, PointerEvent, Window } from '../../../src/browlet/platform';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/index';
import type { NodeImpl } from '../../../src/browlet/dom/nodes/index';
import { PointerButton, type MouseButtonInput } from '../../../src/browlet/interaction/index';
import { EventModifierState } from '../../../src/browlet/interaction/events/index';
import { createManualUserAgent } from '../../support/browlet-agent';
import { getRelevantRealm, project, unwrap } from '../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('Pointer Events §11.2.18: mouse context menus', () => {
  it.each([true, false])('delivers an adapter-selected menu on press=%s, before any qualifying auxclick', (onPress) => {
    const { input, document, loop, a, window, trace, menus, showMenu } = createFixture();
    input.queueButton(buttonInput(true, onPress), document);
    input.queueButton(buttonInput(false, !onPress, true), document);
    expect(trace).toEqual([]);
    loop.runTaskTurn();
    loop.runTaskTurn();
    expect(trace).toEqual(onPress
      ? ['pointerdown:a', 'mousedown:a', 'contextmenu:a', 'menu:a', 'pointerup:a', 'mouseup:a', 'auxclick:a']
      : ['pointerdown:a', 'mousedown:a', 'pointerup:a', 'mouseup:a', 'contextmenu:a', 'menu:a', 'auxclick:a']);
    expect(loop.runTaskTurn()).toBe(false);
    expect(menus).toHaveLength(1);
    const event = menus[0]!;
    expect(event).toBeInstanceOf(window.PointerEvent);
    expect(event).toMatchObject({
      type: 'contextmenu', target: a, isTrusted: true, bubbles: true, cancelable: true, composed: true,
      button: 2, buttons: onPress ? 2 : 0, detail: 0, pointerId: 1, pointerType: 'mouse', isPrimary: false,
      screenX: 12, screenY: -13, clientX: 4, clientY: -6, pressure: 0, width: 1, height: 1,
      tiltX: 0, tiltY: 0, twist: 0, tangentialPressure: 0,
    });
    expect(event.view).toBe(window);
    expect(event.getModifierState('AltGraph')).toBe(true);
    expect(event.getModifierState('Alt')).toBe(false);
    expect(event.altKey).toBe(true);
    expect(event.getPredictedEvents()).toEqual([]);
    expect(showMenu).toHaveBeenCalledExactlyOnceWith(unwrap(a), 12.75, -12.75);
  });

  it('uses adapter recognition rather than treating every secondary press as a menu', () => {
    const { input, document, loop, menus, showMenu } = createFixture();
    input.queueButton(buttonInput(true), document);
    input.queueButton(buttonInput(false), document);
    loop.runTaskTurn();
    loop.runTaskTurn();
    expect(menus).toEqual([]);
    expect(showMenu).not.toHaveBeenCalled();
    // A platform can recognize another gesture, such as a modified primary press.
    input.queueButton({ ...buttonInput(true, true), button: PointerButton.Primary }, document);
    loop.runTaskTurn();
    expect(menus[0]!.button).toBe(0);
    expect(showMenu).toHaveBeenCalledOnce();
  });

  it.each(['pointerdown', 'mousedown'])('does not cancel contextmenu when %s is canceled', (type) => {
    const { input, document, loop, a, menus, showMenu } = createFixture();
    a.addEventListener(type, (event) => event.preventDefault());
    input.queueButton(buttonInput(true, true), document);
    loop.runTaskTurn();
    expect(menus).toHaveLength(1);
    expect(menus[0]!.defaultPrevented).toBe(false);
    expect(showMenu).toHaveBeenCalledOnce();
  });

  it.each([true, false])('honors contextmenu cancellation on press=%s without suppressing auxclick', (onPress) => {
    const { input, document, loop, a, trace, menus, showMenu } = createFixture();
    a.addEventListener('contextmenu', (event) => event.preventDefault());
    input.queueButton(buttonInput(true, onPress), document);
    input.queueButton(buttonInput(false, !onPress, true), document);
    loop.runTaskTurn();
    loop.runTaskTurn();
    expect(menus[0]!.defaultPrevented).toBe(true);
    expect(showMenu).not.toHaveBeenCalled();
    expect(trace.at(-1)).toBe('auxclick:a');
  });

  it('retains receipt-time input despite queued releases and author reinitialization', () => {
    const { input, document, loop, a, window, menus, showMenu } = createFixture();
    let pointer: PointerEvent | null = null;
    a.addEventListener('pointerdown', (event) => {
      pointer = event as PointerEvent;
    });
    // Reinitialization is permitted after pointer dispatch has returned.
    a.addEventListener('mousedown', () => {
      pointer!.initMouseEvent('changed', false, false, null, 99, 999, 999, 999, 999, false, false, false, false, 0, null);
    });
    const down = buttonInput(true, true);
    input.queueButton(down, document);
    input.queueButton(buttonInput(false), document);
    down.contextMenu = false;
    down.screenX = 999;
    down.modifiers = new EventModifierState();
    loop.runTaskTurn();
    expect(pointer!.screenX).toBe(999);
    expect(menus[0]).toMatchObject({ buttons: 2, button: 2, detail: 0, screenX: 12 });
    expect(menus[0]!.view).toBe(window);
    expect(menus[0]!.getModifierState('AltGraph')).toBe(true);
    expect(showMenu).toHaveBeenCalledExactlyOnceWith(unwrap(a), 12.75, -12.75);
  });

  it('does not use author-shadowed contextmenu properties for native menu placement', () => {
    const { input, document, loop, a, showMenu } = createFixture();
    a.addEventListener('contextmenu', (event) => {
      Object.defineProperties(event, { screenX: { value: 999 }, screenY: { value: 999 } });
      expect((event as PointerEvent).screenX).toBe(999);
    });
    input.queueButton(buttonInput(true, true), document);
    loop.runTaskTurn();
    expect(showMenu).toHaveBeenCalledExactlyOnceWith(unwrap(a), 12.75, -12.75);
  });

  it('handles chorded menu transitions using their receipt-time held buttons', () => {
    const { input, document, loop, menus } = createFixture();
    input.queueButton({ ...buttonInput(true), button: PointerButton.Primary }, document);
    input.queueButton(buttonInput(true, true), document);
    input.queueButton(buttonInput(false, true), document);
    input.queueButton({ ...buttonInput(false), button: PointerButton.Primary }, document);
    for (let index = 0; index < 4; index++) loop.runTaskTurn();
    expect(menus.map((event) => [event.button, event.buttons, event.detail, event.pointerId]))
      .toEqual([[2, 3, 0, 1], [2, 1, 0, 1]]);
  });

  it('retains a captured release target after capture loss', () => {
    const { input, document, loop, a, b, menus, hitTest } = createFixture();
    a.addEventListener('pointerdown', (event) => a.setPointerCapture((event as PointerEvent).pointerId));
    input.queueButton(buttonInput(true), document);
    loop.runTaskTurn();
    hitTest.mockReturnValue(unwrap(b));
    let losses = 0;
    a.addEventListener('lostpointercapture', () => { losses++; });
    input.queueButton(buttonInput(false, true), document);
    loop.runTaskTurn();
    expect(losses).toBe(1);
    expect(menus[0]!.target).toBe(a);
    expect(a.hasPointerCapture(1)).toBe(false);
  });

  it('does not apply capture requested by this press before its contextmenu', () => {
    const { input, document, loop, a, b, menus } = createFixture();
    a.addEventListener('pointerdown', (event) => b.setPointerCapture((event as PointerEvent).pointerId));
    input.queueButton(buttonInput(true, true), document);
    loop.runTaskTurn();
    expect(menus[0]!.target).toBe(a);
    expect(b.hasPointerCapture(1)).toBe(true);
  });

  it('retains the selected target when a mouse listener changes the hit-test result', () => {
    const { input, document, loop, a, b, menus, hitTest } = createFixture();
    a.addEventListener('mousedown', () => hitTest.mockReturnValue(unwrap(b)));
    input.queueButton(buttonInput(true, true), document);
    loop.runTaskTurn();
    expect(menus[0]!.target).toBe(a);
    expect(hitTest).toHaveBeenCalledOnce();
  });

  it.each([
    ['mousedown', false], ['mousedown', true], ['mouseup', false], ['mouseup', true],
  ] as const)('after removal in %s, delivers only if reinserted=%s', (type, reinsert) => {
    const { input, document, loop, root, a, menus, showMenu } = createFixture();
    a.addEventListener(type, () => {
      a.remove();
      if (reinsert) root.append(a);
    });
    const onPress = type === 'mousedown';
    input.queueButton(buttonInput(true, onPress), document);
    loop.runTaskTurn();
    if (!onPress) {
      input.queueButton(buttonInput(false, true), document);
      loop.runTaskTurn();
    }
    expect(menus).toHaveLength(reinsert ? 1 : 0);
    expect(showMenu).toHaveBeenCalledTimes(reinsert ? 1 : 0);
  });

  it('preserves the target creation realm and uses its current document view after adoption', () => {
    const { input, document, loop, userAgent, a, menus } = createFixture();
    const owner = getRelevantRealm(a);
    const destination = createWindow(userAgent);
    a.addEventListener('mousedown', () => {
      destination.platformDocument.adoptNode(a);
      destination.root.append(a);
    });
    input.queueButton(buttonInput(true, true), document);
    loop.runTaskTurn();
    expect(getRelevantRealm(menus[0]!)).toBe(owner);
    expect(menus[0]!.view).toBe(destination.window);
  });

  it('reaches the explicit native UI dependency only after uncanceled dispatch', () => {
    const { input, document, loop, a, menus, showMenu } = createFixture();
    showMenu.mockRestore();
    a.addEventListener('contextmenu', (event) => event.preventDefault(), { once: true });
    input.queueButton(buttonInput(true, true), document);
    expect(() => loop.runTaskTurn()).not.toThrow();
    input.queueButton(buttonInput(false, true), document);
    expect(() => loop.runTaskTurn()).toThrow('Mouse input requires native context-menu UI');
    expect(menus).toHaveLength(2);
  });

  it('does not open native UI for author-dispatched contextmenu events', () => {
    const { window, a, menus, showMenu, traversable } = createFixture();
    a.dispatchEvent(new window.PointerEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(menus[0]!.isTrusted).toBe(false);
    expect(showMenu).not.toHaveBeenCalled();
    expect(traversable.pointerEventStreams.size).toBe(0);
  });
});

/** Real bindings and task delivery; replace only the unfinished input/layout/HTML/UI effects. */
function createFixture() {
  const userAgent = createManualUserAgent();
  const fixture = createWindow(userAgent);
  const input = userAgent.mouseInput;
  const hitTest = vi.spyOn(input, 'hitTest').mockReturnValue(unwrap<NodeImpl>(fixture.a));
  vi.spyOn(input, 'hasLockedElement').mockReturnValue(false);
  vi.spyOn(input, 'notifyUserActivation').mockImplementation(() => {});
  vi.spyOn(input, 'focusOnMouseDown').mockImplementation(() => {});
  const trace: string[] = [];
  const menus: PointerEvent[] = [];
  const showMenu = vi.spyOn(input, 'showContextMenu').mockImplementation((target) => {
    trace.push(`menu:${target === unwrap<NodeImpl>(fixture.a) ? 'a' : 'b'}`);
  });
  for (const [target, label] of [[fixture.a, 'a'], [fixture.b, 'b']] as const) {
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'contextmenu', 'auxclick']) {
      target.addEventListener(type, (event) => {
        trace.push(`${type}:${label}`);
        if (type === 'contextmenu') menus.push(event as PointerEvent);
      });
    }
  }
  return { ...fixture, userAgent, input, hitTest, showMenu, trace, menus };
}

function createWindow(userAgent: ReturnType<typeof createManualUserAgent>) {
  const traversable = TopLevelTraversable.create(userAgent, null, '');
  const document = traversable.activeDocument!;
  const platformDocument = project(document) as Document;
  const root = platformDocument.documentElement ?? platformDocument.createElement('html');
  if (!root.isConnected) platformDocument.appendChild(root);
  const a = platformDocument.createElement('div');
  const b = platformDocument.createElement('div');
  root.append(a, b);
  return {
    traversable, document, platformDocument, root, a, b,
    window: project(traversable.activeWindow!) as Window, loop: document.env.realm.agent.eventLoop,
  };
}

function buttonInput(pressed: boolean, contextMenu = false, click = false): MouseButtonInput {
  return {
    button: PointerButton.Secondary, pressed, click, doubleClick: false, contextMenu, clickCount: 2,
    screenX: 12.75, screenY: -12.75, clientX: 4.75, clientY: -5.25,
    modifiers: new EventModifierState({ modifierAltGraph: true }),
  };
}
