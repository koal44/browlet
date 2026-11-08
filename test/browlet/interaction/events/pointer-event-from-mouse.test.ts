import { describe, expect, it, vi } from 'vitest';

import { InternalError } from '../../../../src/infra/index';
import { Browlet } from '../../../../src/browlet/browlet';
import {
  EventModifierState, PointerEventImpl, type MouseEventImpl,
} from '../../../../src/browlet/interaction/events/index';
import type { EventTargetImpl } from '../../../../src/browlet/dom/events/index';
import type { ElementImpl } from '../../../../src/browlet/dom/nodes/index';
import type { PointerEvent as PointerEventPlatform } from '../../../../src/browlet/platform';
import { getRelevantRealm, project, unwrap } from '../../../support/browlet-binding';
import { useFixture } from '../../../support/fixture';

describe('Pointer Events: creation from MouseEvent', () => {
  const prepared = useFixture(() => new Browlet({ route: () => '' }));

  it('copies mouse and UI input data while retaining fresh event identity and creation time', () => {
    const browser = prepared();
    const target = unwrap<ElementImpl>(browser.document.createElement('div'));
    const otherView = new Browlet({ route: () => '' });
    const sourcePlatform = new browser.window.MouseEvent('mousemove', {
      view: otherView.window, detail: 3, screenX: 51.75, screenY: -8.5, clientX: 9.75, clientY: -10.5,
      movementX: 1.25, movementY: -2.75, button: 2, buttons: 3,
      ctrlKey: true, altKey: true, shiftKey: true, metaKey: true,
      modifierCapsLock: true, modifierFnLock: true, relatedTarget: browser.document,
    });
    const source = unwrap<MouseEventImpl>(sourcePlatform);
    source.target = target;
    source.timeStamp = 12;
    const realm = getRelevantRealm(target);
    const clock = vi.spyOn(realm, 'eventTimeStamp').mockReturnValue(400);
    try {
      const event = PointerEventImpl.fromMouseEvent('pointermove', source, true, true);
      const platform = project(event) as PointerEventPlatform;
      expect(platform).not.toBe(sourcePlatform);
      expect(platform).toBeInstanceOf(browser.window.PointerEvent);
      expect(getRelevantRealm(platform)).toBe(realm);
      expect([platform.type, platform.target, platform.view, platform.detail])
        .toEqual(['pointermove', project(target), otherView.window, 3]);
      expect([platform.screenX, platform.screenY, platform.clientX, platform.clientY])
        .toEqual([51, -9, 9, -11]);
      expect([platform.movementX, platform.movementY, platform.button, platform.buttons])
        .toEqual([1.25, -2.75, 2, 3]);
      expect([platform.ctrlKey, platform.altKey, platform.shiftKey, platform.metaKey]).toEqual([true, true, true, true]);
      expect(['CapsLock', 'FnLock', 'AltGraph'].map((key) => platform.getModifierState(key)))
        .toEqual([true, true, false]);
      expect(platform.relatedTarget).toBe(browser.document);
      expect(platform.timeStamp).toBe(400);
      expect(sourcePlatform.timeStamp).toBe(12);
      expect(sourcePlatform.type).toBe('mousemove');
      expect(clock).toHaveBeenCalledTimes(1);
    } finally {
      clock.mockRestore();
    }
  });

  it.each([[false, false], [false, true], [true, false], [true, true]])(
    'uses explicit flags instead of the source flags (bubbles: %s, cancelable: %s)', (bubbles, cancelable) => {
      const browser = prepared();
      const target = unwrap<ElementImpl>(browser.document.createElement('div'));
      const source = unwrap<MouseEventImpl>(new browser.window.MouseEvent('mousedown', {
        bubbles: !bubbles, cancelable: !cancelable, composed: true,
      }));
      source.target = target;
      source.isTrusted = true;
      source.stopImmediatePropagation();
      source.preventDefault();

      const event = PointerEventImpl.fromMouseEvent('pointerdown', source, bubbles, cancelable);
      const platform = project(event) as PointerEventPlatform;
      expect([platform.bubbles, platform.cancelable, platform.composed, platform.isTrusted,
        platform.defaultPrevented, platform.cancelBubble])
        .toEqual([bubbles, cancelable, false, false, false, false]);
      expect(event.immediatePropagationStopped).toBe(false);
      expect([source.bubbles, source.cancelable, source.composed, source.isTrusted, source.propagationStopped])
        .toEqual([!bubbles, !cancelable, true, true, true]);
    },
  );

  it('retains pointer defaults and empty samples when the MouseEvent source is a PointerEvent', () => {
    const browser = prepared();
    const target = unwrap<ElementImpl>(browser.document.createElement('div'));
    const sample = new browser.window.PointerEvent('pointermove');
    const sourcePlatform = new browser.window.PointerEvent('pointermove', {
      pointerId: 8, width: 9, height: 10, pressure: 0.75, tangentialPressure: 0.25,
      tiltX: 12, tiltY: -24, twist: 90, altitudeAngle: 0.5, azimuthAngle: 1,
      pointerType: 'pen', isPrimary: true, persistentDeviceId: 7,
      coalescedEvents: [sample], predictedEvents: [sample], clientX: 5.75, clientY: -3.25,
    });
    const source = unwrap<PointerEventImpl>(sourcePlatform);
    source.target = target;

    const event = PointerEventImpl.fromMouseEvent('pointermove', source, true, true);
    const platform = project(event) as PointerEventPlatform;
    expect([platform.pointerId, platform.width, platform.height, platform.pressure, platform.tangentialPressure,
      platform.tiltX, platform.tiltY, platform.twist, platform.altitudeAngle, platform.azimuthAngle,
      platform.pointerType, platform.isPrimary, platform.persistentDeviceId])
      .toEqual([0, 1, 1, 0, 0, 0, 0, 0, Math.PI / 2, 0, '', false, 0]);
    expect([event.getCoalescedEvents(), event.getPredictedEvents()]).toEqual([[], []]);
    expect(source.getCoalescedEvents()).toEqual([unwrap(sample)]);
    expect(source.getPredictedEvents()).toEqual([unwrap(sample)]);
    expect([platform.clientX, platform.clientY]).toEqual([5.75, -3.25]);
  });

  it.each(['click', 'auxclick', 'contextmenu'])('applies %s coordinate rounding to a fractional source', (type) => {
    const browser = prepared();
    const source = unwrap<PointerEventImpl>(new browser.window.PointerEvent('pointermove', {
      screenX: 1.75, screenY: -2.25, clientX: 3.75, clientY: -4.25,
    }));
    source.target = unwrap<ElementImpl>(browser.document.createElement('div'));
    const event = PointerEventImpl.fromMouseEvent(type, source, true, true);
    const platform = project(event) as PointerEventPlatform;
    expect([platform.screenX, platform.screenY, platform.clientX, platform.clientY]).toEqual([1, -3, 3, -5]);
    expect([source.screenX, source.screenY, source.clientX, source.clientY]).toEqual([1.75, -2.25, 3.75, -4.25]);
  });

  it('preserves native AltGraph handling and the copied modifier snapshot after source reinitialization', () => {
    const browser = prepared();
    const target = unwrap<ElementImpl>(browser.document.createElement('div'));
    const sourcePlatform = new browser.window.MouseEvent('mousemove');
    const source = unwrap<MouseEventImpl>(sourcePlatform);
    source.initializeMouseEvent('mousemove', target, true, true, {
      screenX: 10, screenY: 20, clientX: 3, clientY: 4, buttons: 1,
      modifiers: new EventModifierState({ modifierAltGraph: true, modifierCapsLock: true }),
    });
    const event = PointerEventImpl.fromMouseEvent('pointermove', source, true, true);
    const platform = project(event) as PointerEventPlatform;
    sourcePlatform.initMouseEvent('reset');
    expect([platform.altKey, platform.getModifierState('Alt'), platform.getModifierState('AltGraph'),
      platform.getModifierState('CapsLock')]).toEqual([true, false, true, true]);
    expect([platform.clientX, platform.clientY, platform.buttons]).toEqual([3, 4, 1]);
    expect(sourcePlatform.altKey).toBe(false);
    expect(sourcePlatform.getModifierState('AltGraph')).toBe(false);
  });

  it('accepts a Window target and preserves a null source view', () => {
    const browser = prepared();
    const source = unwrap<MouseEventImpl>(new browser.window.MouseEvent('mousemove'));
    source.target = getRelevantRealm(browser.window).env.window;
    const platform = project(PointerEventImpl.fromMouseEvent('pointermove', source, true, true)) as PointerEventPlatform;
    expect(platform.target).toBe(browser.window);
    expect(platform.view).toBeNull();
  });

  it.each(['none', 'generic'] as const)('rejects an unprepared %s target before allocating an event', (kind) => {
    const browser = prepared();
    const source = unwrap<MouseEventImpl>(new browser.window.MouseEvent('mousemove'));
    if (kind === 'generic') source.target = unwrap<EventTargetImpl>(new browser.window.EventTarget());
    const createEvent = vi.spyOn(getRelevantRealm(browser.window).env, 'createEvent');
    try {
      expect(() => PointerEventImpl.fromMouseEvent('pointermove', source, true, true)).toThrow(InternalError);
      expect(createEvent).not.toHaveBeenCalled();
    } finally {
      createEvent.mockRestore();
    }
  });

  it('does not copy an in-flight dispatch path or dispatch the new event automatically', () => {
    const browser = prepared();
    const element = browser.document.createElement('div');
    browser.document.body!.append(element);
    let converted: PointerEventImpl | undefined;
    const seen: boolean[] = [];
    element.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const source = unwrap<MouseEventImpl>(event);
      expect(source.dispatching).toBe(true);
      expect(source.path.length).toBeGreaterThan(0);
      converted = PointerEventImpl.fromMouseEvent('pointerdown', source, true, true);
      const platform = project(converted) as PointerEventPlatform;
      expect([platform.currentTarget, platform.eventPhase, platform.defaultPrevented, platform.isTrusted])
        .toEqual([null, 0, false, false]);
      expect(platform.composedPath()).toEqual([]);
      expect(converted.dispatching).toBe(false);
    });
    element.addEventListener('pointerdown', (event) => {
      seen.push(event.isTrusted);
      event.preventDefault();
    });
    element.dispatchEvent(new browser.window.MouseEvent('mousedown', { cancelable: true, bubbles: true }));
    expect(seen).toEqual([]);
    expect(converted).toBeDefined();
    converted!.isTrusted = true;
    expect(unwrap<ElementImpl>(element).dispatch(converted!)).toBe(false);
    element.dispatchEvent(project(converted!) as PointerEventPlatform);
    expect(seen).toEqual([true, false]);
  });
});

describe('Pointer Events: creation from MouseEvent across environments', () => {
  const prepared = useFixture(() => [new Browlet({ route: () => '' }), new Browlet({ route: () => '' })] as const);

  it('uses the selected target realm without copying a foreign source timestamp', () => {
    const owner = prepared()[0];
    const targetBrowser = prepared()[1];
    const source = unwrap<MouseEventImpl>(new owner.window.MouseEvent('mousemove', { view: owner.window }));
    source.target = unwrap<ElementImpl>(targetBrowser.document.createElement('div'));
    source.timeStamp = 9000;
    const targetRealm = getRelevantRealm(targetBrowser.window);
    const clock = vi.spyOn(targetRealm, 'eventTimeStamp').mockReturnValue(15);
    try {
      const event = PointerEventImpl.fromMouseEvent('pointermove', source, true, true);
      const platform = project(event) as PointerEventPlatform;
      expect(getRelevantRealm(platform)).toBe(targetRealm);
      expect(platform).toBeInstanceOf(targetBrowser.window.PointerEvent);
      expect(platform.target).toBe(project(source.target));
      expect(platform.view).toBe(owner.window);
      expect(platform.timeStamp).toBe(15);
      expect(source.timeStamp).toBe(9000);
    } finally {
      clock.mockRestore();
    }
  });
});
