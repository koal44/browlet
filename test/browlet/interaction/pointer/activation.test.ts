import { describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import type { Element, PointerEvent } from '../../../../src/browlet/platform';
import type { ElementImpl } from '../../../../src/browlet/dom/nodes/index';
import { PointerEventStream } from '../../../../src/browlet/interaction/index';
import {
  PointerEventImpl, type MouseEventImpl, type PointerActivationEventType, type PointerEventInit, type PointerInputEventType,
} from '../../../../src/browlet/interaction/events/index';
import { getRelevantRealm, project, unwrap } from '../../../support/browlet-binding';

describe('Pointer Events §3.3.12: activation events', () => {
  it.each<PointerActivationEventType>(['click', 'auxclick', 'contextmenu'])(
    'creates %s with pointer identity, default pointer fields, integer coordinates, and independent dispatch state', (type) => {
      const { browser, stream, send, a, activations } = createFixture();
      const sample = new PointerEventImpl('pointermove');
      const input: PointerEventInit = {
        pointerType: 'pen', isPrimary: true, persistentDeviceId: 9, width: 12, height: 13,
        pressure: 0.75, tangentialPressure: 0.5, tiltX: 20, tiltY: 30, twist: 45,
        altitudeAngle: 0.5, azimuthAngle: 1, screenX: 10.75, screenY: -20.25,
        clientX: 30.75, clientY: -40.25, movementX: 1.5, movementY: -2.5,
        ctrlKey: true, modifierCapsLock: true, button: 2, buttons: 2,
        coalescedEvents: [sample], predictedEvents: [sample],
      };
      a.addEventListener('pointerdown', (event) => event.preventDefault());
      send('pointerdown', a, input);
      if (type !== 'contextmenu') send('pointerup', a, { ...input, buttons: 0 });
      expect(stream.dispatchActivation(type, 2)).toBe(true);
      expect(activations).toHaveLength(1);
      const event = activations[0]!;
      expect(event).toBeInstanceOf(browser.window.PointerEvent);
      expect(event.view === browser.window).toBe(true);
      expect(event).toMatchObject({
        type, target: a, bubbles: true, cancelable: true, composed: true,
        isTrusted: true, defaultPrevented: false, pointerId: 7, pointerType: 'pen',
        width: 1, height: 1, pressure: 0, tangentialPressure: 0, tiltX: 0, tiltY: 0,
        twist: 0, altitudeAngle: Math.PI / 2, azimuthAngle: 0, isPrimary: false, persistentDeviceId: 0,
        screenX: 10, screenY: -21, clientX: 30, clientY: -41, detail: 2, button: 2,
        movementX: 1.5, movementY: -2.5, relatedTarget: null, ctrlKey: true,
        buttons: type === 'contextmenu' ? 2 : 0,
      });
      expect(event.getModifierState('CapsLock')).toBe(true);
      expect(event.getPredictedEvents()).toEqual([]);
      expect(unwrap<PointerEventImpl>(event).getCoalescedEvents()).toEqual([]);
    },
  );

  it.each<PointerActivationEventType>(['click', 'auxclick'])(
    'targets an uncaptured %s at the current common ancestor', (type) => {
      const { stream, send, a, b, parent, outer, activations } = createFixture();
      send('pointerdown', a);
      send('pointerup', b);
      stream.dispatchActivation(type, 1);
      expect(activations[0]!.target).toBe(parent);
      outer.append(a);
      stream.dispatchActivation(type, 2);
      expect(activations[1]!.target).toBe(outer);
    },
  );

  it('keeps a captured release target after loss and hover restoration', () => {
    const { stream, send, a, b, activations, delivered } = createFixture();
    send('pointerdown', a);
    stream.setPointerCapture(unwrap<ElementImpl>(a), 1);
    send('pointerup', b);
    expect(stream.capture.targetOverride).toBeNull();
    expect(stream.previousTarget).toBe(unwrap(b));
    const before = delivered.slice();
    expect(stream.dispatchActivation('click', 1)).toBe(true);
    expect(activations[0]!.target).toBe(a);
    expect(delivered).toEqual([...before, 'click']);
    expect(stream.previousTarget).toBe(unwrap(b));
  });

  it('dispatches a click when a chorded release produces pointermove', () => {
    const { stream, send, a, activations } = createFixture();
    send('pointerdown', a, { button: 0, buttons: 1 });
    send('pointermove', a, { button: 1, buttons: 5 });
    send('pointermove', a, { button: 0, buttons: 4 });
    stream.dispatchActivation('click', 1);
    expect(activations).toHaveLength(1);
    expect(activations[0]).toMatchObject({ type: 'click', target: a, button: 0, buttons: 4 });
  });

  it('pairs each chorded release with that button’s press target', () => {
    const { stream, send, a, b, parent, activations } = createFixture();
    send('pointerdown', a, { button: 0, buttons: 1 });
    send('pointermove', b, { button: 1, buttons: 5 });
    send('pointermove', b, { button: 0, buttons: 4 });
    stream.dispatchActivation('click', 1);
    send('pointerup', b, { button: 1, buttons: 0 });
    stream.dispatchActivation('auxclick', 1);
    expect(activations.map((event) => [event.type, event.target])).toEqual([['click', parent], ['auxclick', b]]);
  });

  it('does not let a raw button update consume the release pair before pointermove', () => {
    const { stream, send, a, activations } = createFixture();
    send('pointerdown', a, { button: 0, buttons: 1 });
    send('pointermove', a, { button: 1, buttons: 5 });
    send('pointerrawupdate', a, { button: 0, buttons: 4 });
    stream.dispatchActivation('click', 1);
    expect(activations).toEqual([]);
    send('pointermove', a, { button: 0, buttons: 4 });
    stream.dispatchActivation('click', 1);
    expect(activations).toHaveLength(1);
  });

  it('clears every held-button press target on cancellation', () => {
    const { stream, send, a, activations } = createFixture();
    send('pointerdown', a, { button: 0, buttons: 1 });
    send('pointermove', a, { button: 1, buttons: 5 });
    stream.suppress(() => unwrap<ElementImpl>(a));
    send('pointermove', a, { button: 0, buttons: 4 });
    stream.dispatchActivation('click', 1);
    send('pointerup', a, { button: 1, buttons: 0 });
    stream.dispatchActivation('auxclick', 1);
    expect(activations).toEqual([]);
  });

  it('retains an implicit-capture release across non-hover exit', () => {
    const { stream, send, a, b, activations } = createFixture();
    stream.isDirectManipulation = true;
    send('pointerdown', a, { pointerType: 'touch' });
    send('pointerup', b, { pointerType: 'touch', buttons: 0 }, null);
    expect(stream.previousTarget).toBeNull();
    stream.dispatchActivation('click', 1);
    expect(activations[0]).toMatchObject({ target: a, pointerId: 7, pointerType: 'touch' });
  });

  it('does not substitute capture requested after the release or process that request', () => {
    const { stream, send, a, b, parent, activations } = createFixture();
    send('pointerdown', a);
    send('pointerup', b);
    stream.setPointerCapture(unwrap<ElementImpl>(a), 1);
    stream.dispatchActivation('click', 1);
    expect(activations[0]!.target).toBe(parent);
    expect(stream.capture.targetOverride).toBeNull();
    expect(stream.capture.pendingTargetOverride).toBe(unwrap(a));
  });

  it('uses the context-menu interaction target for either the down or up platform convention', () => {
    const { stream, send, a, b, activations } = createFixture();
    send('pointerdown', a, { button: 2, buttons: 2 });
    stream.dispatchActivation('contextmenu', 0);
    send('pointerup', b, { button: 2, buttons: 0 });
    stream.dispatchActivation('contextmenu', 0);
    expect(activations.map((event) => event.target)).toEqual([a, b]);
  });

  it('retains input and original targets despite author reinitialization and unrelated motion', () => {
    const { stream, send, a, b, parent, activations } = createFixture();
    const down = project(send('pointerdown', a)) as PointerEvent;
    down.initEvent('author-down');
    const up = project(send('pointerup', b, { clientX: 12.5, ctrlKey: true })) as PointerEvent;
    up.initMouseEvent('author-up', false, false, null, 0, 0, 0, 999, 999, false, false, false, false, 0, null);
    send('pointermove', a, { clientX: 55 });
    stream.dispatchActivation('click', 1);
    expect(activations[0]).toMatchObject({ target: parent, clientX: 12, ctrlKey: true });
  });

  it('does not dispatch without a press/release pair, after cancellation, or without a common ancestor', () => {
    const { stream, send, a, b, activations } = createFixture();
    expect(stream.dispatchActivation('click', 1)).toBe(true);
    send('pointerup', b);
    stream.dispatchActivation('click', 1);
    send('pointerdown', a);
    stream.dispatchActivation('auxclick', 1);
    stream.suppress(() => unwrap<ElementImpl>(a));
    stream.dispatchActivation('contextmenu', 0);
    send('pointerdown', a);
    send('pointerup', b);
    a.remove();
    stream.dispatchActivation('click', 1);
    expect(activations).toEqual([]);
  });

  it('reports activation cancellation without canceling later stream delivery', () => {
    const { stream, send, a, activations } = createFixture();
    a.addEventListener('click', (event) => event.preventDefault());
    send('pointerdown', a);
    send('pointerup', a);
    expect(stream.dispatchActivation('click', 1)).toBe(false);
    expect(activations[0]!.defaultPrevented).toBe(true);
    send('pointerdown', a);
    send('pointerup', a);
    expect(stream.dispatchActivation('auxclick', 1)).toBe(true);
  });

  it.each(['click', 'dblclick'])('reports %s cancellation while still delivering both events', (type) => {
    const { stream, send, a } = createFixture();
    const events: string[] = [];
    for (const name of ['click', 'dblclick']) {
      a.addEventListener(name, (event) => {
        events.push(event.type);
        if (event.type === type) event.preventDefault();
      });
    }
    send('pointerdown', a);
    send('pointerup', a);
    expect(stream.dispatchActivation('click', 2, true)).toBe(false);
    expect(events).toEqual(['click', 'dblclick']);
  });

  it('crosses shadow hosts and slots to find the actual activation target', () => {
    const { browser, stream, send, a, b, parent, activations } = createFixture();
    const root = a.attachShadow({ mode: 'open' });
    const inner = browser.document.createElement('span');
    root.append(inner);
    send('pointerdown', inner);
    send('pointerup', b);
    stream.dispatchActivation('click', 1);
    expect(activations[0]!.target).toBe(parent);

    const wrapper = browser.document.createElement('div');
    const slot = browser.document.createElement('slot');
    wrapper.append(slot, inner);
    root.append(wrapper);
    const slotted = browser.document.createElement('span');
    a.append(slotted);
    const pathTargets: unknown[] = [];
    root.addEventListener('click', (event) => pathTargets.push(event.composedPath()[0]));
    send('pointerdown', slotted);
    send('pointerup', inner);
    stream.dispatchActivation('click', 1);
    expect(activations[1]!.target).toBe(a);
    expect(pathTargets).toEqual([wrapper]);
  });

  it('gives non-pointer activation its supplied target, target realm, and reserved identity', () => {
    const { browser, a, activations } = createFixture();
    const other = new Browlet({ route: () => '' });
    const source = unwrap<MouseEventImpl>(new other.window.MouseEvent('input', {
      view: other.window, ctrlKey: true, modifierNumLock: true, clientX: 20.5,
    }));
    const target = unwrap<ElementImpl>(a);
    const realm = getRelevantRealm(target);
    const clock = vi.spyOn(realm, 'eventTimeStamp').mockReturnValue(321);
    try {
      const event = PointerEventImpl.createActivation('click', target, source);
      expect(target.dispatch(event)).toBe(true);
      const platform = activations[0]!;
      expect(platform).toBeInstanceOf(browser.window.PointerEvent);
      expect(getRelevantRealm(platform)).toBe(realm);
      expect(platform.view === browser.window).toBe(true);
      expect(platform).toMatchObject({
        target: a, timeStamp: 321, pointerId: -1, pointerType: '', isPrimary: false,
        ctrlKey: true, clientX: 20, detail: 0,
      });
      expect(platform.getModifierState('NumLock')).toBe(true);
    } finally { clock.mockRestore(); }
  });

  it('leaves author construction and dispatch independent of native activation policy', async () => {
    const { browser } = createFixture();
    expect(await browser.evaluate(() => {
      const target = document.querySelector('#a')!;
      const event = new PointerEvent('click', { pointerId: 99, pointerType: 'pen', isPrimary: true, pressure: 0.75 });
      target.dispatchEvent(event);
      return [event.target === target, event.pointerId, event.isPrimary, event.pressure, event.isTrusted];
    })).toEqual([true, 99, true, 0.75, false]);
  });
});

/** Real realm allocation/dispatch, with only normalized input and hit testing supplied by the fixture. */
function createFixture() {
  const browser = new Browlet({ route: () => '' });
  const outer = browser.document.createElement('div');
  const parent = browser.document.createElement('div');
  const a = browser.document.createElement('div');
  const b = browser.document.createElement('div');
  a.id = 'a';
  parent.append(a, b);
  outer.append(parent);
  browser.document.body!.append(outer);
  const stream = new PointerEventStream(7, false, true, () => false);
  const activations: PointerEvent[] = [];
  const delivered: string[] = [];
  for (const type of ['pointerdown', 'pointerup', 'pointerover', 'pointerout', 'gotpointercapture',
    'lostpointercapture', 'click', 'auxclick', 'contextmenu']) {
    browser.document.addEventListener(type, (event) => {
      delivered.push(type);
      if (type === 'click' || type === 'auxclick' || type === 'contextmenu') activations.push(event as PointerEvent);
    }, true);
  }
  const send = (type: PointerInputEventType, hit: Element, init: PointerEventInit = {}, hover: Element | null = hit) => {
    const input = new PointerEventImpl(type, {
      pointerType: 'mouse', button: type === 'pointermove' || type === 'pointerrawupdate' ? -1 : 0,
      buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1, ...init,
    });
    const target = stream.prepareTarget(type, input, () => unwrap<ElementImpl>(hit));
    const event = target.createTrustedEvent(PointerEventImpl);
    event.copyInputFrom(input);
    event.setPointerEventAttributes(type);
    stream.dispatchToTarget(event, target, () => hover === null ? null : unwrap<ElementImpl>(hover), 1);
    return event;
  };
  return { browser, stream, send, a, b, parent, outer, activations, delivered };
}
