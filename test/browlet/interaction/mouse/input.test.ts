import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Document, MouseEvent, PointerEvent, Window } from '../../../../src/browlet/platform';
import { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/index';
import type { DocumentImpl, NodeImpl } from '../../../../src/browlet/dom/nodes/index';
import { PointerButton, type MouseButton, type MouseButtonInput } from '../../../../src/browlet/interaction/index';
import { EventModifierState } from '../../../../src/browlet/interaction/events/index';
import { userInteractionTaskSource } from '../../../../src/browlet/scripting/index';
import { createManualUserAgent } from '../../../support/browlet-agent';
import { getRelevantRealm, project, unwrap } from '../../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('Pointer Events §§11.2.10–11.2.13: mouse input', () => {
  it('queues button actions through HTML tasks and delivers trusted pointer/mouse events to author listeners', () => {
    const fixture = createFixture();
    const { input, document, loop, a, window, trace, received, focus, activation, traversable } = fixture;
    const down = buttonInput(true);
    input.queueButton(down, document);
    input.queueButton(buttonInput(false), document);
    down.clientX = 999;
    down.button = PointerButton.Secondary;
    down.clickCount = 999;
    expect(trace).toEqual([]);
    expect(traversable.pointerEventStreams.size).toBe(0);
    const tasks = [...loop.getTaskQueue(userInteractionTaskSource)];
    expect(tasks).toHaveLength(2);
    expect(tasks.every((task) => task.document === document)).toBe(true);

    expect(loop.runTaskTurn()).toBe(true);
    expect(trace).toEqual(['pointerdown:a', 'mousedown:a']);
    expect(focus).toHaveBeenCalledWith(unwrap(a));
    expect(activation).toHaveBeenCalledWith(document);
    expect(traversable.pointerEventStreams.has(1)).toBe(true);
    expect(loop.runTaskTurn()).toBe(true);
    expect(trace).toEqual(['pointerdown:a', 'mousedown:a', 'pointerup:a', 'mouseup:a']);
    expect(loop.runTaskTurn()).toBe(false);
    expect(received.map((event) => [event.button, event.buttons, event.detail]))
      .toEqual([[0, 1, 0], [0, 1, 2], [0, 0, 0], [0, 0, 2]]);
    for (const event of received) {
      expect([event.isTrusted, event.bubbles, event.cancelable, event.composed]).toEqual([true, true, true, true]);
      expect(event.view).toBe(window);
      expect(event.getModifierState('AltGraph')).toBe(true);
      expect(event.getModifierState('Alt')).toBe(false);
      expect(event.altKey).toBe(true);
    }
    const pointer = received[0] as PointerEvent;
    const mouse = received[1]!;
    expect([pointer.pointerId, pointer.pointerType, pointer.isPrimary, pointer.pressure]).toEqual([1, 'mouse', true, 0.5]);
    expect([pointer.clientX, pointer.screenY, mouse.clientX, mouse.screenY]).toEqual([4.75, -12.75, 4, -13]);
    expect((received[2] as PointerEvent).pressure).toBe(0);
  });

  it.each<[MouseButton, number]>([
    [PointerButton.Primary, 1], [PointerButton.Auxiliary, 4], [PointerButton.Secondary, 2],
    [PointerButton.Back, 8], [PointerButton.Forward, 16],
  ])('maps logical button %s to held-button mask %s', (button, mask) => {
    const { input, document, loop, received, contextMenu } = createFixture();
    input.queueButton(buttonInput(true, button), document);
    input.queueButton(buttonInput(false, button), document);
    loop.runTaskTurn();
    loop.runTaskTurn();
    expect(received.map((event) => [event.button, event.buttons]))
      .toEqual([[button, mask], [button, mask], [button, 0], [button, 0]]);
    expect(contextMenu).toHaveBeenCalledTimes(button === PointerButton.Secondary ? 1 : 0);
  });

  it('uses pointermove for chords while preserving every mouse button transition', () => {
    const { input, document, loop, trace, received, focus } = createFixture();
    for (const action of [buttonInput(true), buttonInput(true, PointerButton.Secondary),
      buttonInput(false), buttonInput(false, PointerButton.Secondary)]) input.queueButton(action, document);
    for (let index = 0; index < 4; index++) expect(loop.runTaskTurn()).toBe(true);
    expect(trace).toEqual(['pointerdown:a', 'mousedown:a', 'pointermove:a', 'mousedown:a',
      'pointermove:a', 'mouseup:a', 'pointerup:a', 'mouseup:a']);
    expect(received.map((event) => event.buttons)).toEqual([1, 1, 3, 3, 2, 2, 0, 0]);
    expect(focus).toHaveBeenCalledTimes(2);
  });

  it('ignores duplicate button reports without queuing duplicate tasks', () => {
    const { input, document, loop, trace } = createFixture();
    input.queueButton(buttonInput(false), document);
    input.queueButton(buttonInput(true), document);
    input.queueButton(buttonInput(true), document);
    input.queueButton(buttonInput(false), document);
    input.queueButton(buttonInput(false), document);
    expect([...loop.getTaskQueue(userInteractionTaskSource)]).toHaveLength(2);
    loop.runTaskTurn();
    loop.runTaskTurn();
    expect(trace).toEqual(['pointerdown:a', 'mousedown:a', 'pointerup:a', 'mouseup:a']);
  });

  it.each(['pointerdown', 'mousedown'])('honors %s cancellation before calling HTML focus', (type) => {
    const { input, document, loop, a, trace, focus, activation } = createFixture();
    a.addEventListener(type, (event) => event.preventDefault(), { once: true });
    input.queueButton(buttonInput(true), document);
    input.queueButton(buttonInput(false), document);
    loop.runTaskTurn();
    loop.runTaskTurn();
    expect(trace).toEqual(type === 'pointerdown' ? ['pointerdown:a', 'pointerup:a']
      : ['pointerdown:a', 'mousedown:a', 'pointerup:a', 'mouseup:a']);
    expect(focus).not.toHaveBeenCalled();
    expect(activation).toHaveBeenCalledOnce();
    input.queueButton(buttonInput(true), document);
    loop.runTaskTurn();
    expect(trace.slice(-2)).toEqual(['pointerdown:a', 'mousedown:a']);
    expect(focus).toHaveBeenCalledOnce();
  });

  it('runs mouse focusing after mousedown and context-menu processing after the secondary press', () => {
    const { input, document, loop, a, trace, focus, contextMenu, activation } = createFixture();
    activation.mockImplementation(() => { trace.push('activation'); });
    focus.mockImplementation(() => { trace.push('focus'); });
    contextMenu.mockImplementation(() => { trace.push('contextmenu'); });
    input.queueButton(buttonInput(true, PointerButton.Secondary), document);
    loop.runTaskTurn();
    expect(trace).toEqual(['activation', 'pointerdown:a', 'mousedown:a', 'focus', 'contextmenu']);
    expect(contextMenu).toHaveBeenCalledWith(unwrap(a), 12.75, -12.75);
  });

  it('registers the stream before listeners request capture and restores the hit target after release', () => {
    const { input, document, loop, a, b, trace, hitTest } = createFixture();
    a.addEventListener('pointerdown', (event) => {
      a.setPointerCapture((event as PointerEvent).pointerId);
      expect(a.hasPointerCapture(1)).toBe(true);
    });
    for (const type of ['gotpointercapture', 'lostpointercapture']) {
      a.addEventListener(type, () => { trace.push(type); });
    }
    input.queueButton(buttonInput(true), document);
    loop.runTaskTurn();
    hitTest.mockReturnValue(unwrap(b));
    input.queueButton(buttonInput(false), document);
    loop.runTaskTurn();
    expect(trace).toEqual(['pointerdown:a', 'mousedown:a', 'gotpointercapture', 'pointerup:a', 'mouseup:a', 'lostpointercapture']);
    expect(a.hasPointerCapture(1)).toBe(false);
    input.queueButton(buttonInput(true), document);
    loop.runTaskTurn();
    expect(trace.slice(-2)).toEqual(['pointerdown:b', 'mousedown:b']);
  });

  it('shares input receipt state across Windows while retaining independent context streams and task snapshots', () => {
    const first = createFixture();
    const second = createWindow(first.userAgent);
    first.hitTest.mockImplementation((document) => document === first.document ? unwrap(first.a) : unwrap(second.a));
    const secondEvents: PointerEvent[] = [];
    for (const type of ['pointerdown', 'pointermove', 'pointerup']) {
      second.a.addEventListener(type, (event) => { secondEvents.push(event as PointerEvent); });
    }
    first.input.queueButton(buttonInput(true), first.document);
    first.input.queueButton(buttonInput(true, PointerButton.Auxiliary), second.document);
    first.input.queueButton(buttonInput(false), first.document);
    second.loop.runTaskTurn();
    first.loop.runTaskTurn();
    first.loop.runTaskTurn();
    expect(secondEvents.map((event) => [event.type, event.buttons, event.isPrimary])).toEqual([['pointermove', 5, true]]);
    expect(first.received.map((event) => event.buttons)).toEqual([1, 1, 4, 4]);
    expect(first.traversable.pointerEventStreams.get(1)).not.toBe(second.traversable.pointerEventStreams.get(1));
    const independent = createFixture();
    independent.input.queueButton(buttonInput(true), independent.document);
    independent.loop.runTaskTurn();
    expect(independent.received[0]!.type).toBe('pointerdown');
    expect(independent.received[0]!.buttons).toBe(1);
  });

  it('allocates at an adopted target’s creation realm while exposing its current Document view', () => {
    const fixture = createFixture();
    const destination = createWindow(fixture.userAgent);
    destination.root.appendChild(destination.platformDocument.adoptNode(fixture.a));
    fixture.hitTest.mockReturnValue(unwrap(fixture.a));
    const owner = getRelevantRealm(fixture.a);
    vi.spyOn(owner, 'eventTimeStamp').mockReturnValue(125);
    vi.spyOn(destination.document.env.realm, 'eventTimeStamp').mockReturnValue(875);
    fixture.input.queueButton(buttonInput(true), destination.document);
    fixture.input.queueButton(buttonInput(false, PointerButton.Primary, true), destination.document);
    destination.loop.runTaskTurn();
    destination.loop.runTaskTurn();
    const [pointer, mouse] = fixture.received;
    expect(getRelevantRealm(pointer!)).toBe(owner);
    expect(getRelevantRealm(mouse!)).toBe(owner);
    expect(pointer!.view).toBe(destination.window);
    expect(mouse!.view).toBe(destination.window);
    expect(pointer!.timeStamp).toBe(125);
    expect(mouse!.timeStamp).toBe(125);
    const click = fixture.received[4]!;
    expect(click.type).toBe('click');
    expect(getRelevantRealm(click)).toBe(owner);
    expect(click.view).toBe(destination.window);
    expect(click.timeStamp).toBe(125);
  });

  it('keeps author-created mouse events outside input state and stream registration', () => {
    const { input, document, window, loop, a, trace, traversable } = createFixture();
    a.dispatchEvent(new window.MouseEvent('mousedown', { buttons: 1 }));
    expect(traversable.pointerEventStreams.size).toBe(0);
    trace.length = 0;
    input.queueButton(buttonInput(true), document);
    loop.runTaskTurn();
    expect(trace).toEqual(['pointerdown:a', 'mousedown:a']);
  });

  it('does not register a stream after its top-level destination is removed', () => {
    const { input, document, loop, userAgent, traversable, trace } = createFixture();
    input.queueButton(buttonInput(true), document);
    userAgent.removeTopLevelTraversable(traversable);
    loop.runTaskTurn();
    expect(trace).toEqual([]);
    expect(traversable.pointerEventStreams.size).toBe(0);
    expect(() => input.queueButton(buttonInput(false), document)).toThrow(/live browsing context/);
  });

  it('fails explicitly when the reached layout or focus dependency is unavailable', () => {
    const layout = createFixture();
    layout.hitTest.mockRestore();
    layout.input.queueButton(buttonInput(true), layout.document);
    expect(() => layout.loop.runTaskTurn()).toThrow(/layout hit testing/);
    expect(layout.trace).toEqual([]);

    const focus = createFixture();
    focus.focus.mockRestore();
    focus.input.queueButton(buttonInput(true), focus.document);
    expect(() => focus.loop.runTaskTurn()).toThrow(/HTML click focusability/);
    expect(focus.trace).toEqual(['pointerdown:a', 'mousedown:a']);
  });
});

describe('Pointer Events §§11.2.14–11.2.15: native clicks', () => {
  it.each<MouseButton>([
    PointerButton.Primary, PointerButton.Auxiliary, PointerButton.Secondary, PointerButton.Back, PointerButton.Forward,
  ])('sends a qualifying button %s click after mouseup in the same task', (button) => {
    const { input, document, loop, a, window, trace, received } = createFixture();
    const activate = vi.spyOn(unwrap<NodeImpl>(a), 'runActivationBehavior').mockImplementation(() => {});
    input.queueButton(buttonInput(true, button), document);
    input.queueButton(buttonInput(false, button, true), document);
    expect([...loop.getTaskQueue(userInteractionTaskSource)]).toHaveLength(2);
    loop.runTaskTurn();
    expect(trace).toEqual(['pointerdown:a', 'mousedown:a']);
    loop.runTaskTurn();
    const type = button === PointerButton.Primary ? 'click' : 'auxclick';
    expect(trace).toEqual(['pointerdown:a', 'mousedown:a', 'pointerup:a', 'mouseup:a', `${type}:a`]);
    expect(loop.runTaskTurn()).toBe(false);
    const click = received[4] as PointerEvent;
    expect(click).toBeInstanceOf(window.PointerEvent);
    expect(click).toMatchObject({
      type, target: a, button, buttons: 0, detail: 2, isTrusted: true,
      bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: 'mouse',
      isPrimary: false, pressure: 0, screenX: 12, screenY: -13, clientX: 4, clientY: -6,
    });
    expect(click.view).toBe(window);
    expect(click.altKey).toBe(true);
    expect(click.getModifierState('AltGraph')).toBe(true);
    expect(click.getModifierState('Alt')).toBe(false);
    expect(activate).toHaveBeenCalledTimes(button === PointerButton.Primary ? 1 : 0);
  });

  it('retains the adapter’s click decision and count at receipt', () => {
    const { input, document, loop, received } = createFixture();
    const release = buttonInput(false, PointerButton.Primary, true);
    input.queueButton(buttonInput(true), document);
    input.queueButton(release, document);
    release.click = false;
    release.clickCount = 999;
    loop.runTaskTurn();
    loop.runTaskTurn();
    expect(received[4]).toMatchObject({ type: 'click', detail: 2 });
    input.queueButton(buttonInput(true), document);
    input.queueButton(buttonInput(false), document);
    loop.runTaskTurn();
    loop.runTaskTurn();
    expect(received.filter((event) => event.type === 'click')).toHaveLength(1);
  });

  it.each(['pointerdown', 'mousedown', 'mouseup'])('does not confuse %s cancellation with click recognition', (type) => {
    const { input, document, loop, a, trace, received, focus } = createFixture();
    a.addEventListener(type, (event) => event.preventDefault());
    input.queueButton(buttonInput(true), document);
    input.queueButton(buttonInput(false, PointerButton.Primary, true), document);
    loop.runTaskTurn();
    loop.runTaskTurn();
    expect(trace).toEqual(type === 'pointerdown' ? ['pointerdown:a', 'pointerup:a', 'click:a']
      : ['pointerdown:a', 'mousedown:a', 'pointerup:a', 'mouseup:a', 'click:a']);
    expect(received.at(-1)!.defaultPrevented).toBe(false);
    expect(focus).toHaveBeenCalledTimes(type === 'mouseup' ? 1 : 0);
  });

  it.each([false, true])('uses DOM activation behavior and click cancellation (canceled=%s)', (canceled) => {
    const { input, document, loop, a, trace } = createFixture();
    // HTML owns the action; the real DOM dispatch must call it only after an uncanceled click.
    const activate = vi.spyOn(unwrap<NodeImpl>(a), 'runActivationBehavior').mockImplementation(() => {
      trace.push('activate');
    });
    if (canceled) a.addEventListener('click', (event) => event.preventDefault());
    input.queueButton(buttonInput(true), document);
    input.queueButton(buttonInput(false, PointerButton.Primary, true), document);
    loop.runTaskTurn();
    loop.runTaskTurn();
    expect(activate).toHaveBeenCalledTimes(canceled ? 0 : 1);
    expect(trace.slice(-2)).toEqual(canceled ? ['mouseup:a', 'click:a'] : ['click:a', 'activate']);
  });

  it.each<[MouseButton, boolean, boolean]>([
    [PointerButton.Primary, false, false], [PointerButton.Primary, true, false],
    [PointerButton.Auxiliary, false, false], [PointerButton.Auxiliary, true, false],
    [PointerButton.Primary, false, true], [PointerButton.Primary, true, true],
    [PointerButton.Auxiliary, false, true], [PointerButton.Auxiliary, true, true],
  ])('checks mouseup removal (button=%s, captured=%s, reinsert=%s)', (button, captured, reinsert) => {
    const { input, document, loop, root, a, received, hitTest } = createFixture();
    const activate = vi.spyOn(unwrap<NodeImpl>(a), 'runActivationBehavior').mockImplementation(() => {});
    if (captured) a.addEventListener('pointerdown', (event) => a.setPointerCapture((event as PointerEvent).pointerId));
    a.addEventListener('mouseup', () => {
      a.remove();
      if (reinsert) root.append(a);
      hitTest.mockReturnValue(unwrap<NodeImpl>(root));
    });
    input.queueButton(buttonInput(true, button), document);
    input.queueButton(buttonInput(false, button, true), document);
    loop.runTaskTurn();
    loop.runTaskTurn();
    expect(received.map((event) => event.type)).toEqual([
      'pointerdown', 'mousedown', 'pointerup', 'mouseup',
      ...(reinsert ? [button === PointerButton.Primary ? 'click' : 'auxclick'] : []),
    ]);
    expect(activate).toHaveBeenCalledTimes(reinsert && button === PointerButton.Primary ? 1 : 0);
  });

  it('keeps the captured release target after lostpointercapture and hover restoration', () => {
    const { input, document, loop, a, b, trace, hitTest, received } = createFixture();
    a.addEventListener('pointerdown', () => a.setPointerCapture(1));
    a.addEventListener('lostpointercapture', () => { trace.push('lostpointercapture'); });
    input.queueButton(buttonInput(true), document);
    loop.runTaskTurn();
    hitTest.mockReturnValue(unwrap(b));
    input.queueButton(buttonInput(false, PointerButton.Primary, true), document);
    loop.runTaskTurn();
    expect(trace).toEqual(['pointerdown:a', 'mousedown:a', 'pointerup:a', 'mouseup:a', 'lostpointercapture', 'click:a']);
    expect(received.at(-1)!.target).toBe(a);
    expect(a.hasPointerCapture(1)).toBe(false);
  });

  it('pairs chorded clicks independently and sends primary clicks before the final pointerup', () => {
    const { input, document, loop, a, b, root, hitTest } = createFixture();
    const clicks: [string, unknown][] = [];
    for (const type of ['click', 'auxclick']) root.addEventListener(type, (event) => { clicks.push([type, event.target]); });
    input.queueButton(buttonInput(true), document);
    loop.runTaskTurn();
    hitTest.mockReturnValue(unwrap(b));
    input.queueButton(buttonInput(true, PointerButton.Auxiliary), document);
    input.queueButton(buttonInput(false, PointerButton.Primary, true), document);
    input.queueButton(buttonInput(false, PointerButton.Auxiliary, true), document);
    loop.runTaskTurn();
    loop.runTaskTurn();
    expect(clicks).toEqual([['click', root]]);
    loop.runTaskTurn();
    expect(clicks).toEqual([['click', root], ['auxclick', b]]);
    expect(a.parentNode).toBe(root);
  });

  it('uses retained release input when listeners reinitialize pointerup and mouseup', () => {
    const { input, document, loop, a, received } = createFixture();
    a.addEventListener('pointerup', (event) => event.initEvent('author-up'));
    a.addEventListener('mouseup', (event) => {
      (event as MouseEvent).initMouseEvent('author-mouseup', false, false, null, 0, 0, 0, 999, 999,
        false, false, false, false, 2, null);
    });
    input.queueButton(buttonInput(true), document);
    input.queueButton(buttonInput(false, PointerButton.Primary, true), document);
    loop.runTaskTurn();
    loop.runTaskTurn();
    expect(received.at(-1)).toMatchObject({ type: 'click', button: 0, clientX: 4, detail: 2, altKey: true });
  });
});

describe('Pointer Events §11.2.16: native double-clicks', () => {
  it('delivers a trusted MouseEvent after the second click in its release task', () => {
    const { input, document, loop, a, window, received, trace } = createFixture();
    const firstDown = { ...buttonInput(true), clickCount: 1 };
    const firstUp = { ...buttonInput(false, PointerButton.Primary, true), clickCount: 1 };
    for (const action of [firstDown, firstUp, buttonInput(true), doubleClickInput()]) input.queueButton(action, document);
    expect([...loop.getTaskQueue(userInteractionTaskSource)]).toHaveLength(4);
    for (let index = 0; index < 3; index++) loop.runTaskTurn();
    expect(trace.filter((type) => type === 'dblclick:a')).toEqual([]);
    loop.runTaskTurn();
    expect(trace).toEqual(['pointerdown:a', 'mousedown:a', 'pointerup:a', 'mouseup:a', 'click:a',
      'pointerdown:a', 'mousedown:a', 'pointerup:a', 'mouseup:a', 'click:a', 'dblclick:a']);
    expect(loop.runTaskTurn()).toBe(false);
    const event = received.at(-1)!;
    expect(event).toBeInstanceOf(window.MouseEvent);
    expect(event).not.toBeInstanceOf(window.PointerEvent);
    expect(event).toMatchObject({
      target: a, type: 'dblclick', detail: 2, button: 0, buttons: 0,
      bubbles: true, cancelable: true, composed: true, isTrusted: true, defaultPrevented: false,
      screenX: 12, screenY: -13, clientX: 4, clientY: -6, movementX: 0, movementY: 0, relatedTarget: null,
    });
    expect(event.view).toBe(window);
    expect(event.getModifierState('AltGraph')).toBe(true);
    expect(event.getModifierState('Alt')).toBe(false);
    expect(event.altKey).toBe(true);
  });

  it('snapshots recognition without deriving it from a click count of two', () => {
    const { input, document, loop, received } = createFixture();
    input.queueButton(buttonInput(true), document);
    input.queueButton(buttonInput(false, PointerButton.Primary, true), document);
    loop.runTaskTurn();
    loop.runTaskTurn();
    expect(received.at(-1)).toMatchObject({ type: 'click', detail: 2 });
    const release = doubleClickInput();
    input.queueButton(buttonInput(true), document);
    input.queueButton(release, document);
    release.doubleClick = false;
    release.clickCount = 999;
    loop.runTaskTurn();
    loop.runTaskTurn();
    expect(received.at(-1)).toMatchObject({ type: 'dblclick', detail: 2 });
  });

  it.each<MouseButton>([PointerButton.Auxiliary, PointerButton.Secondary, PointerButton.Back, PointerButton.Forward])(
    'does not deliver dblclick for non-primary button %s', (button) => {
      const { input, document, loop, received } = createFixture();
      input.queueButton(buttonInput(true, button), document);
      input.queueButton({ ...doubleClickInput(), button }, document);
      loop.runTaskTurn();
      loop.runTaskTurn();
      expect(received.at(-1)!.type).toBe('auxclick');
    },
  );

  it.each(['pointerdown', 'mousedown', 'mouseup', 'click'])('keeps dblclick independent of %s cancellation', (type) => {
    const { input, document, loop, a, received, trace } = createFixture();
    a.addEventListener(type, (event) => event.preventDefault());
    input.queueButton(buttonInput(true), document);
    input.queueButton(doubleClickInput(), document);
    loop.runTaskTurn();
    loop.runTaskTurn();
    expect(trace.slice(-2)).toEqual(['click:a', 'dblclick:a']);
    expect(received.at(-1)!.defaultPrevented).toBe(false);
  });

  it('retains the click target when its listener changes the layout hit result', () => {
    const { input, document, loop, a, b, hitTest, received } = createFixture();
    a.addEventListener('click', () => { hitTest.mockReturnValue(unwrap(b)); });
    input.queueButton(buttonInput(true), document);
    input.queueButton(doubleClickInput(), document);
    loop.runTaskTurn();
    loop.runTaskTurn();
    expect(received.at(-1)).toMatchObject({ type: 'dblclick', target: a });
    // Down, up, then post-release hover; double-click must not do a fourth hit test.
    expect(hitTest).toHaveBeenCalledTimes(3);
  });

  it('uses the common click ancestor when press and release targets differ', () => {
    const { input, document, loop, b, root, hitTest } = createFixture();
    const targets: unknown[] = [];
    root.addEventListener('dblclick', (event) => { targets.push(event.target); });
    input.queueButton(buttonInput(true), document);
    loop.runTaskTurn();
    hitTest.mockReturnValue(unwrap(b));
    input.queueButton(doubleClickInput(), document);
    loop.runTaskTurn();
    expect(targets).toEqual([root]);
  });

  it('uses the captured click target after release has restored hover', () => {
    const { input, document, loop, a, b, hitTest, received } = createFixture();
    a.addEventListener('pointerdown', () => b.setPointerCapture(1));
    input.queueButton(buttonInput(true), document);
    loop.runTaskTurn();
    input.queueButton(doubleClickInput(), document);
    loop.runTaskTurn();
    expect(hitTest).toHaveBeenCalledTimes(2);
    expect(received.slice(-2).map((event) => [event.type, event.target])).toEqual([['click', b], ['dblclick', b]]);
    expect(b.hasPointerCapture(1)).toBe(false);
  });

  it.each([false, true])('checks connectivity after click listeners (reinsert=%s)', (reinsert) => {
    const { input, document, loop, a, root, received } = createFixture();
    a.addEventListener('click', () => {
      a.remove();
      if (reinsert) root.appendChild(a);
    });
    input.queueButton(buttonInput(true), document);
    input.queueButton(doubleClickInput(), document);
    loop.runTaskTurn();
    loop.runTaskTurn();
    // The fixture also listens directly on a, so detached dispatch cannot escape this assertion.
    expect(received.at(-1)!.type).toBe(reinsert ? 'dblclick' : 'click');
  });

  it('keeps native input private and gives dblclick a fresh target-realm timestamp', () => {
    const { input, document, loop, a, received } = createFixture();
    let now = 100;
    const realm = getRelevantRealm(a);
    vi.spyOn(realm, 'eventTimeStamp').mockImplementation(() => now);
    a.addEventListener('click', (event) => {
      (event as MouseEvent).initMouseEvent('author-click', false, false, null, 999, 999, 999, 999, 999,
        false, false, false, false, 2, null);
      now = 200;
    });
    input.queueButton(buttonInput(true), document);
    input.queueButton(doubleClickInput(), document);
    loop.runTaskTurn();
    loop.runTaskTurn();
    expect(received.at(-2)!.timeStamp).toBe(100);
    expect(received.at(-1)).toMatchObject({ type: 'dblclick', timeStamp: 200, button: 0, detail: 2, clientX: 4, altKey: true });
    expect(getRelevantRealm(received.at(-1)!)).toBe(realm);
  });

  it('does not run click activation a second time or synthesize dblclick for author dispatch', () => {
    const { input, document, loop, a, window, received } = createFixture();
    const activate = vi.spyOn(unwrap<NodeImpl>(a), 'runActivationBehavior').mockImplementation(() => {});
    a.dispatchEvent(new window.MouseEvent('click', { detail: 2 }));
    expect(received.map((event) => event.type)).toEqual(['click']);
    activate.mockClear();
    input.queueButton(buttonInput(true), document);
    input.queueButton(doubleClickInput(), document);
    loop.runTaskTurn();
    loop.runTaskTurn();
    expect(activate).toHaveBeenCalledOnce();
    expect(received.at(-1)!.type).toBe('dblclick');
  });
});

/** Real Window bindings and task turns; only the unfinished owner dependencies are controlled. */
function createFixture() {
  const userAgent = createManualUserAgent();
  const fixture = createWindow(userAgent);
  const input = userAgent.mouseInput;
  const hitTest = vi.spyOn(input, 'hitTest').mockReturnValue(unwrap<NodeImpl>(fixture.a));
  vi.spyOn(input, 'hasLockedElement').mockReturnValue(false);
  const focus = vi.spyOn(input, 'focusOnMouseDown').mockImplementation(() => {});
  const activation = vi.spyOn(input, 'notifyUserActivation').mockImplementation(() => {});
  const contextMenu = vi.spyOn(input, 'showContextMenu').mockImplementation(() => {});
  const trace: string[] = [];
  const received: MouseEvent[] = [];
  for (const [target, label] of [[fixture.a, 'a'], [fixture.b, 'b']] as const) {
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mouseup', 'click', 'auxclick', 'dblclick']) {
      target.addEventListener(type, (event) => {
        trace.push(`${type}:${label}`);
        received.push(event as MouseEvent);
      });
    }
  }
  return { ...fixture, userAgent, input, hitTest, focus, activation, contextMenu, trace, received };
}

function createWindow(userAgent: ReturnType<typeof createManualUserAgent>) {
  const traversable = TopLevelTraversable.create(userAgent, null, '');
  const document: DocumentImpl = traversable.activeDocument!;
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

function buttonInput(pressed: boolean, button: MouseButton = PointerButton.Primary, click = false): MouseButtonInput {
  return {
    button, pressed, click, doubleClick: false, contextMenu: pressed && button === PointerButton.Secondary, clickCount: 2,
    screenX: 12.75, screenY: -12.75, clientX: 4.75, clientY: -5.25,
    modifiers: new EventModifierState({ modifierAltGraph: true }),
  };
}

function doubleClickInput(): MouseButtonInput {
  return { ...buttonInput(false, PointerButton.Primary, true), doubleClick: true };
}
