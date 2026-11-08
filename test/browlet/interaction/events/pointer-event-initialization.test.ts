import { describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import {
  EventModifierState, PointerEventImpl, type MouseEventImpl, type MouseEventInput,
} from '../../../../src/browlet/interaction/events/index';
import type { ElementImpl } from '../../../../src/browlet/dom/nodes/index';
import type { PointerEvent as PointerEventPlatform } from '../../../../src/browlet/platform';
import { getRelevantRealm, project, unwrap } from '../../../support/browlet-binding';
import { useFixture } from '../../../support/fixture';

describe('Pointer Events: producer initialization and creation', () => {
  const prepared = useFixture(() => new Browlet({ route: () => '' }));

  it('initializes MouseEvent from mapped input and resets UI, button, and movement fields', () => {
    const browser = prepared();
    const target = unwrap<ElementImpl>(browser.document.createElement('div'));
    const platform = new browser.window.MouseEvent('before', {
      cancelable: true, detail: 8, button: 4, buttons: 16, movementX: 6, movementY: -7,
      ctrlKey: true, altKey: true, modifierCapsLock: true,
    });
    const event = unwrap<MouseEventImpl>(platform);
    const timeStamp = platform.timeStamp;
    platform.preventDefault();
    platform.stopImmediatePropagation();
    event.isTrusted = true;
    const input = mouseInput();
    input.modifiers = new EventModifierState({ shiftKey: true, metaKey: true, modifierAltGraph: true });

    event.initializeMouseEvent('mousemove', target, true, false, input);

    expect([platform.type, platform.target, platform.view, platform.detail]).toEqual([
      'mousemove', project(target), browser.window, 0,
    ]);
    expect([platform.bubbles, platform.cancelable, platform.isTrusted, platform.defaultPrevented,
      platform.cancelBubble, event.immediatePropagationStopped]).toEqual([true, false, false, false, false, false]);
    expect([platform.screenX, platform.screenY, platform.clientX, platform.clientY]).toEqual([12, -13, 4, -6]);
    expect([platform.button, platform.buttons, platform.movementX, platform.movementY]).toEqual([0, 5, 0, 0]);
    expect([platform.ctrlKey, platform.shiftKey, platform.altKey, platform.metaKey]).toEqual([false, true, true, true]);
    expect(['Alt', 'AltGraph', 'CapsLock'].map((key) => platform.getModifierState(key))).toEqual([false, true, false]);
    expect(platform.timeStamp).toBe(timeStamp);
  });

  it('keeps native AltGraph handling separate from construction and legacy initialization', () => {
    const browser = prepared();
    const target = unwrap<ElementImpl>(browser.document.createElement('div'));
    const platform = new browser.window.PointerEvent('pointermove', { modifierAltGraph: true });
    const event = unwrap<PointerEventImpl>(platform);
    expect([platform.altKey, platform.getModifierState('Alt'), platform.getModifierState('AltGraph')])
      .toEqual([false, false, true]);
    const input = mouseInput();
    input.modifiers = new EventModifierState({ modifierAltGraph: true });
    event.initializePointerEvent('pointermove', target, true, true, input);

    const copy = target.createTrustedEvent(PointerEventImpl);
    copy.copyInputFrom(event);
    platform.initMouseEvent('legacy');
    expect([platform.altKey, platform.getModifierState('AltGraph')]).toEqual([false, false]);
    expect([copy.altKey, copy.getModifierState('Alt'), copy.getModifierState('AltGraph')]).toEqual([true, false, true]);
  });

  it('clears every pointer-specific field and sample list without modifying retained samples', () => {
    const browser = prepared();
    const target = unwrap<ElementImpl>(browser.document.createElement('div'));
    const sample = new browser.window.PointerEvent('pointermove', { pointerId: 9, clientX: 25 });
    const platform = new browser.window.PointerEvent('before', {
      pointerId: 9, width: 8, height: 7, pressure: 0.75, tangentialPressure: -0.5,
      tiltX: 30, tiltY: -40, twist: 90, altitudeAngle: 0.4, azimuthAngle: 0.8,
      pointerType: 'pen', isPrimary: true, persistentDeviceId: 27,
      coalescedEvents: [sample], predictedEvents: [sample], movementX: 5, movementY: 6,
    });
    const event = unwrap<PointerEventImpl>(platform);
    const oldCoalesced = event.getCoalescedEvents();
    const oldPredicted = event.getPredictedEvents();
    const timeStamp = platform.timeStamp;
    event.initializePointerEvent('pointermove', target, false, true, mouseInput());

    expect([platform.pointerId, platform.width, platform.height, platform.pressure, platform.tangentialPressure,
      platform.tiltX, platform.tiltY, platform.twist, platform.altitudeAngle, platform.azimuthAngle,
      platform.pointerType, platform.isPrimary, platform.persistentDeviceId])
      .toEqual([0, 1, 1, 0, 0, 0, 0, 0, Math.PI / 2, 0, '', false, 0]);
    expect([event.getCoalescedEvents(), event.getPredictedEvents()]).toEqual([[], []]);
    expect(oldCoalesced).toEqual([unwrap(sample)]);
    expect(oldPredicted).toEqual([unwrap(sample)]);
    expect([sample.pointerId, sample.clientX]).toEqual([9, 25]);
    expect(platform.timeStamp).toBe(timeStamp);
    expect(getRelevantRealm(platform)).toBe(getRelevantRealm(browser.window));
  });

  it.each(['pointermove', 'pointerdown', 'custom', 'click', 'auxclick', 'contextmenu'])(
    'initializes %s coordinates with the constructor compatibility rule', (type) => {
      const browser = prepared();
      const target = unwrap<ElementImpl>(browser.document.createElement('div'));
      const event = PointerEventImpl.create(type, target, true, true, mouseInput());
      const platform = project(event) as PointerEventPlatform;
      const integral = type === 'click' || type === 'auxclick' || type === 'contextmenu';
      const expected = integral ? [12, -13, 4, -6] : [12.75, -12.25, 4.5, -5.5];
      expect([platform.screenX, platform.screenY, platform.clientX, platform.clientY]).toEqual(expected);
      platform.initEvent(integral ? 'pointermove' : 'click');
      expect([platform.screenX, platform.screenY, platform.clientX, platform.clientY]).toEqual(expected);
    },
  );

  it.each([[false, false], [false, true], [true, false], [true, true]])(
    'preserves the caller-supplied flags (bubbles: %s, cancelable: %s)', (bubbles, cancelable) => {
      const browser = prepared();
      const target = unwrap<ElementImpl>(browser.document.createElement('div'));
      const event = PointerEventImpl.create('pointerenter', target, bubbles, cancelable, mouseInput());
      const platform = project(event) as PointerEventPlatform;
      expect([platform.bubbles, platform.cancelable, platform.composed, platform.isTrusted])
        .toEqual([bubbles, cancelable, false, false]);
      expect(platform.target).toBe(project(target));
      expect(platform.view).toBe(browser.window);
      expect(platform.detail).toBe(0);
      // Creation is separate from the firing algorithm's type-dependent attributes.
      event.setPointerEventAttributes('pointerenter');
      expect([platform.bubbles, platform.cancelable, platform.composed]).toEqual([false, false, false]);
    },
  );

  it('allocates fresh platform identities and timestamps through the target environment', () => {
    const browser = prepared();
    const target = unwrap<ElementImpl>(browser.document.createElement('div'));
    const realm = getRelevantRealm(target);
    const clock = vi.spyOn(realm, 'eventTimeStamp').mockReturnValueOnce(125).mockReturnValueOnce(130);
    try {
      const first = PointerEventImpl.create('pointermove', target, true, true, mouseInput());
      const second = PointerEventImpl.create('pointermove', target, true, true, mouseInput());
      const firstPlatform = project(first) as PointerEventPlatform;
      const secondPlatform = project(second) as PointerEventPlatform;
      expect(firstPlatform).not.toBe(secondPlatform);
      expect(firstPlatform).toBeInstanceOf(browser.window.PointerEvent);
      expect(secondPlatform).toBeInstanceOf(browser.window.PointerEvent);
      expect([firstPlatform.timeStamp, secondPlatform.timeStamp]).toEqual([125, 130]);
      expect(getRelevantRealm(firstPlatform)).toBe(realm);
      expect(getRelevantRealm(secondPlatform)).toBe(realm);
      expect(clock).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
    }
  });

  it('supports a Window target through the existing UIEvent initialization contract', () => {
    const browser = prepared();
    const target = getRelevantRealm(browser.window).env.window;
    const event = PointerEventImpl.create('pointermove', target, true, false, mouseInput());
    const platform = project(event) as PointerEventPlatform;
    expect([platform.target, platform.view]).toEqual([browser.window, browser.window]);
    expect(getRelevantRealm(platform)).toBe(getRelevantRealm(browser.window));
  });

  it('leaves dispatch and trust to the producer and preserves author redispatch rules', () => {
    const browser = prepared();
    const element = browser.document.createElement('div');
    const target = unwrap<ElementImpl>(element);
    const seen: boolean[] = [];
    element.addEventListener('pointerdown', (event) => {
      seen.push(event.isTrusted);
      event.preventDefault();
    });
    const event = PointerEventImpl.create('pointerdown', target, true, true, mouseInput());
    expect(seen).toEqual([]);
    event.isTrusted = true;
    expect(target.dispatch(event)).toBe(false);
    element.dispatchEvent(project(event) as PointerEventPlatform);
    expect(seen).toEqual([true, false]);
  });
});

describe('Pointer Events: producer initialization and creation across environments', () => {
  const prepared = useFixture(() => [new Browlet({ route: () => '' }), new Browlet({ route: () => '' })] as const);

  it('selects an adopted target\'s current view independently of its retained allocation realm', () => {
    const owner = prepared()[0];
    const other = prepared()[1];
    const element = owner.document.createElement('div');
    other.document.adoptNode(element);
    const target = unwrap<ElementImpl>(element);
    const event = PointerEventImpl.create('pointermove', target, true, true, mouseInput());
    const platform = project(event) as PointerEventPlatform;
    expect(getRelevantRealm(platform)).toBe(getRelevantRealm(target));
    expect(platform.target).toBe(element);
    expect(platform.view).toBe(other.window);
  });
});

function mouseInput(): MouseEventInput {
  return {
    screenX: 12.75, screenY: -12.25, clientX: 4.5, clientY: -5.5, buttons: 5,
    modifiers: new EventModifierState(),
  };
}
