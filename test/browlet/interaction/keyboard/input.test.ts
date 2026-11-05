import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Document, KeyboardEvent, Window } from '../../../../src/browlet/platform';
import { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/index';
import type { DocumentImpl, ElementImpl } from '../../../../src/browlet/dom/nodes/index';
import { EventModifierState } from '../../../../src/browlet/interaction/events/index';
import type { KeyboardInput } from '../../../../src/browlet/interaction/keyboard/index';
import { userInteractionTaskSource } from '../../../../src/browlet/scripting/index';
import { monotonicClock, UnsafeMoment } from '../../../../src/timing/index';
import { createManualUserAgent } from '../../../support/browlet-agent';
import { getRelevantRealm, project, unwrap } from '../../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('UI Events §§3.5.4–3.5.6: queued keyboard input', () => {
  it('delivers trusted key events through HTML tasks with receipt-time input snapshots', () => {
    const { input, document, loop, a, window, trace, received, activation, effect } = createFixture();
    const down = keyInput(true, { text: 'e\u0301', modifiers: new EventModifierState({ shiftKey: true, modifierCapsLock: true }) });
    input.queueKey(down, document);
    input.queueKey(keyInput(false), document);
    down.text = 'changed';
    down.code = 'KeyZ';
    down.keyCode = 999;
    down.modifiers = new EventModifierState();
    expect(trace).toEqual([]);
    const tasks = [...loop.getTaskQueue(userInteractionTaskSource)];
    expect(tasks).toHaveLength(2);
    expect(tasks.every((task) => task.document === document)).toBe(true);
    expect(loop.runTaskTurn()).toBe(true);
    expect(loop.runTaskTurn()).toBe(true);
    expect(loop.runTaskTurn()).toBe(false);
    expect(trace).toEqual(['activation', 'keydown:a', 'default:a', 'keyup:a']);
    expect(activation).toHaveBeenCalledOnce();
    expect(effect).toHaveBeenCalledWith(unwrap(a), expect.objectContaining({ text: 'e\u0301', code: 'KeyQ', keyCode: 81 }));
    expect(received.map((event) => [event.key, event.code, event.keyCode, event.charCode, event.which]))
      .toEqual([['é', 'KeyQ', 81, 0, 81], ['q', 'KeyQ', 81, 0, 81]]);
    for (const event of received) {
      expect([event.isTrusted, event.bubbles, event.cancelable, event.composed, event.detail])
        .toEqual([true, true, true, true, 0]);
      expect(event).toBeInstanceOf(window.KeyboardEvent);
      expect(event.view).toBe(window);
      expect(getRelevantRealm(event)).toBe(document.env.realm);
      expect(Number.isFinite(event.timeStamp)).toBe(true);
    }
    expect(received.map((event) => [event.shiftKey, event.getModifierState('CapsLock')]))
      .toEqual([[true, true], [false, false]]);
  });

  it('cancels default actions without canceling modifier updates or the later keyup', () => {
    const { input, document, loop, a, received, effect, activation } = createFixture();
    a.addEventListener('keydown', (event) => event.preventDefault());
    const shifted = new EventModifierState({ shiftKey: true });
    input.queueKey(keyInput(true, { namedKey: 'Shift', text: null, code: 'ShiftLeft', location: 1, modifiers: shifted }), document);
    expect(input.modifiers).toBe(shifted);
    loop.runTaskTurn();
    input.queueKey(keyInput(false, { namedKey: 'Shift', text: null, code: 'ShiftLeft', location: 1 }), document);
    expect(input.modifiers.getModifierState('Shift')).toBe(false);
    loop.runTaskTurn();
    expect(effect).not.toHaveBeenCalled();
    expect(activation).toHaveBeenCalledOnce();
    expect(received.map((event) => [event.type, event.shiftKey, event.defaultPrevented]))
      .toEqual([['keydown', true, true], ['keyup', false, false]]);
  });

  it('uses fresh release layout facts and preserves lock/side state supplied by the adapter', () => {
    const { input, document, loop, received } = createFixture();
    input.queueKey(keyInput(true, { text: 'Q', modifiers: new EventModifierState({ shiftKey: true, modifierNumLock: true }) }), document);
    input.queueKey(keyInput(false, { modifiers: new EventModifierState({ modifierNumLock: true }) }), document);
    loop.runTaskTurn();
    loop.runTaskTurn();
    expect(received.map((event) => [event.key, event.code, event.shiftKey, event.getModifierState('NumLock')]))
      .toEqual([['Q', 'KeyQ', true, true], ['q', 'KeyQ', false, true]]);
    // Releasing one side does not clear the other side; aggregate native state is authoritative.
    input.queueKey(keyInput(false, {
      namedKey: 'Control', text: null, code: 'ControlLeft', location: 1,
      modifiers: new EventModifierState({ ctrlKey: true }),
    }), document);
    loop.runTaskTurn();
    expect(received.at(-1)!.ctrlKey).toBe(true);
    expect(input.modifiers.getModifierState('Control')).toBe(true);
  });

  it('selects focus at delivery and again for keyup after a keydown listener changes it', () => {
    const { input, document, loop, a, b, focus, trace } = createFixture();
    focus.mockReturnValue({ domAnchor: unwrap<ElementImpl>(b) });
    b.addEventListener('keydown', () => { focus.mockReturnValue({ domAnchor: unwrap<ElementImpl>(a) }); });
    input.queueKey(keyInput(true), document);
    input.queueKey(keyInput(false), document);
    loop.runTaskTurn();
    loop.runTaskTurn();
    expect(trace).toEqual(['activation', 'keydown:b', 'default:b', 'keyup:a']);
  });

  it('delivers repeated presses and lets each repeat cancel its own default action', () => {
    const { input, document, loop, a, received, effect } = createFixture();
    a.addEventListener('keydown', (event) => { if ((event as KeyboardEvent).repeat) event.preventDefault(); });
    input.queueKey(keyInput(true), document);
    input.queueKey(keyInput(true, { repeat: true }), document);
    input.queueKey(keyInput(false), document);
    for (let turn = 0; turn < 3; turn++) loop.runTaskTurn();
    expect(received.map((event) => [event.type, event.repeat])).toEqual([['keydown', false], ['keydown', true], ['keyup', false]]);
    expect(effect).toHaveBeenCalledOnce();
  });

  it('retains the input timestamp when delivery is delayed', () => {
    const { input, document, loop, received } = createFixture();
    const receipt = new UnsafeMoment(monotonicClock, document.env.timeOrigin.milliseconds + 123.456);
    const clock = vi.spyOn(monotonicClock, 'unsafeCurrentTime').mockReturnValue(receipt);
    input.queueKey(keyInput(true), document);
    clock.mockReturnValue(new UnsafeMoment(monotonicClock, receipt.milliseconds + 100));
    loop.runTaskTurn();
    expect(received[0]!.timeStamp).toBe(document.env.relativeHighResolutionTime(receipt).toTimestamp());
  });

  it('shares current modifier state across Windows but not queued snapshots or event realms', () => {
    const first = createFixture();
    const second = createWindow(first.userAgent);
    const secondEvents: KeyboardEvent[] = [];
    second.a.addEventListener('keydown', (event) => { secondEvents.push(event as KeyboardEvent); });
    const held = new EventModifierState({ ctrlKey: true, modifierAltGraph: true });
    first.input.queueKey(keyInput(true, { modifiers: held }), first.document);
    first.input.queueKey(keyInput(true), second.document);
    expect(first.input.modifiers.getModifierState('Control')).toBe(false);
    second.loop.runTaskTurn();
    first.loop.runTaskTurn();
    expect(first.received[0]!.ctrlKey).toBe(true);
    expect(first.received[0]!.getModifierState('AltGraph')).toBe(true);
    expect(secondEvents[0]!.ctrlKey).toBe(false);
    expect(getRelevantRealm(secondEvents[0]!)).toBe(second.document.env.realm);
    expect(secondEvents[0]!.view).toBe(second.window);
    expect(secondEvents[0]).not.toBeInstanceOf(first.window.KeyboardEvent);
    const independent = createManualUserAgent();
    expect(independent.keyboardInput.modifiers.getModifierState('Control')).toBe(false);
  });

  it('does not let synthetic dispatch update device state or invoke producer effects', () => {
    const { input, a, window, effect, activation } = createFixture();
    a.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Shift', shiftKey: true }));
    expect(input.modifiers.getModifierState('Shift')).toBe(false);
    expect(effect).not.toHaveBeenCalled();
    expect(activation).not.toHaveBeenCalled();
  });

  it.each([
    { namedKey: 'Escape', reservedShortcut: false },
    { namedKey: 'F1', reservedShortcut: true },
  ] as const)('excludes $namedKey from activation while still delivering it', (fields) => {
    const { input, document, loop, received, activation, effect } = createFixture();
    input.queueKey(keyInput(true, fields), document);
    loop.runTaskTurn();
    expect(received[0]!.key).toBe(fields.namedKey);
    expect(activation).not.toHaveBeenCalled();
    expect(effect).toHaveBeenCalledOnce();
  });

  it('keeps composition handling explicit and passes cancellation to that owner', () => {
    const { input, document, loop, a, received, effect, composition } = createFixture();
    a.addEventListener('keydown', (event) => event.preventDefault());
    input.queueKey(keyInput(true, { isComposing: true, namedKey: 'Process', text: null, keyCode: 229 }), document);
    input.queueKey(keyInput(false, { isComposing: true, namedKey: 'Process', text: null, keyCode: 229 }), document);
    loop.runTaskTurn();
    loop.runTaskTurn();
    expect(received.map((event) => [event.key, event.isComposing])).toEqual([['Process', true], ['Process', true]]);
    expect(composition).toHaveBeenCalledWith(unwrap(a), expect.objectContaining({ isComposing: true }), true);
    expect(composition).toHaveBeenCalledOnce();
    expect(effect).not.toHaveBeenCalled();
  });

  it('uses the true shadow focus anchor and lets DOM retarget the composed event', () => {
    const { input, document, platformDocument, loop, a, focus } = createFixture();
    const shadow = a.attachShadow({ mode: 'closed' });
    const inner = platformDocument.createElement('input');
    shadow.append(inner);
    focus.mockReturnValue({ domAnchor: unwrap<ElementImpl>(inner) });
    const seen: unknown[] = [];
    inner.addEventListener('keydown', (event) => { seen.push(event.target); });
    a.addEventListener('keydown', (event) => { seen.push(event.target); });
    input.queueKey(keyInput(true), document);
    loop.runTaskTurn();
    expect(seen).toEqual([inner, a]);
  });

  it('uses body, then the root element, when the focused area is the viewport', () => {
    const { input, document, platformDocument, root, loop, focus, effect } = createFixture();
    focus.mockReturnValue({ domAnchor: document });
    const body = platformDocument.body ?? platformDocument.createElement('body');
    if (!body.isConnected) root.append(body);
    input.queueKey(keyInput(true), document);
    loop.runTaskTurn();
    expect(effect).toHaveBeenLastCalledWith(unwrap(body), expect.anything());
    body.remove();
    input.queueKey(keyInput(true), document);
    loop.runTaskTurn();
    expect(effect).toHaveBeenLastCalledWith(unwrap(root), expect.anything());
  });

  it('does not deliver to a Document that lost system focus before its task ran', () => {
    const { input, document, loop, hasFocus, received, activation } = createFixture();
    input.queueKey(keyInput(true), document);
    hasFocus.mockReturnValue(false);
    loop.runTaskTurn();
    expect(received).toEqual([]);
    expect(activation).not.toHaveBeenCalled();
  });

  it('rejects input from another UserAgent before changing modifier state', () => {
    const first = createFixture();
    const foreign = createWindow(createManualUserAgent());
    expect(() => first.input.queueKey(keyInput(true, { modifiers: new EventModifierState({ shiftKey: true }) }), foreign.document))
      .toThrow('live browsing context owned by this UserAgent');
    expect(first.input.modifiers.getModifierState('Shift')).toBe(false);
  });

  it('does not deliver queued input after its top-level context is removed', () => {
    const { input, document, userAgent, traversable, loop, received } = createFixture();
    input.queueKey(keyInput(true), document);
    userAgent.topLevelTraversableSet.delete(traversable);
    loop.runTaskTurn();
    expect(received).toEqual([]);
    expect(() => input.queueKey(keyInput(false), document)).toThrow('live browsing context');
  });

  it('uses HTML task activity gating before asking for focus or default actions', () => {
    const { input, document, loop, hasFocus, received } = createFixture();
    input.queueKey(keyInput(true), document);
    const activity = vi.spyOn(document, 'isFullyActive').mockReturnValue(false);
    expect(loop.runTaskTurn()).toBe(false);
    expect(hasFocus).not.toHaveBeenCalled();
    expect(received).toEqual([]);
    activity.mockRestore();
    expect(loop.runTaskTurn()).toBe(true);
  });

  it('retains named throwing dependencies instead of assuming focus, activation, or editing', () => {
    const { input, document, a, focus, hasFocus, activation, effect, composition } = createFixture();
    focus.mockRestore();
    hasFocus.mockRestore();
    activation.mockRestore();
    effect.mockRestore();
    composition.mockRestore();
    expect(() => document.focusedArea).toThrow('Document focused area');
    expect(() => document.hasFocus()).toThrow('Document focus state');
    expect(() => input.notifyUserActivation(document)).toThrow('HTML user activation');
    expect(() => input.applyDefaultAction(unwrap(a), keyInput(true))).toThrow('default actions');
    expect(() => input.handleCompositionKey(unwrap(a), keyInput(true), false)).toThrow('IME composition');
  });
});

function createFixture() {
  const userAgent = createManualUserAgent();
  const fixture = createWindow(userAgent);
  const input = userAgent.keyboardInput;
  const trace: string[] = [];
  const received: KeyboardEvent[] = [];
  const activation = vi.spyOn(input, 'notifyUserActivation').mockImplementation(() => { trace.push('activation'); });
  const effect = vi.spyOn(input, 'applyDefaultAction').mockImplementation((target) => {
    trace.push('default:' + (target === unwrap<ElementImpl>(fixture.a) ? 'a' : 'b'));
  });
  const composition = vi.spyOn(input, 'handleCompositionKey').mockImplementation(() => {});
  for (const [target, label] of [[fixture.a, 'a'], [fixture.b, 'b']] as const) {
    for (const type of ['keydown', 'keyup']) {
      target.addEventListener(type, (event) => {
        trace.push(type + ':' + label);
        received.push(event as KeyboardEvent);
      });
    }
  }
  return { ...fixture, input, userAgent, trace, received, activation, effect, composition };
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
  const focus = vi.spyOn(document, 'focusedArea', 'get').mockReturnValue({ domAnchor: unwrap<ElementImpl>(a) });
  const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  return {
    traversable, document, platformDocument, root, a, b, focus, hasFocus,
    window: project(traversable.activeWindow!) as Window, loop: document.env.realm.agent.eventLoop,
  };
}

function keyInput(pressed: boolean, fields: Partial<KeyboardInput> = {}): KeyboardInput {
  return {
    pressed, namedKey: null, text: 'q', glyphText: 'q', hasNonGlyphModifiers: false,
    code: 'KeyQ', location: 0, repeat: false, isComposing: false, keyCode: 81,
    reservedShortcut: false, modifiers: new EventModifierState(), ...fields,
  };
}
