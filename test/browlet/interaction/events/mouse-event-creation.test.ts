import { describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { EventModifierState, MouseEventImpl, type MouseEventInput } from '../../../../src/browlet/interaction/events/index';
import type { ElementImpl } from '../../../../src/browlet/dom/nodes/index';
import type { MouseEvent as MouseEventPlatform } from '../../../../src/browlet/platform';
import { getRelevantRealm, project, unwrap } from '../../../support/browlet-binding';

describe('Pointer Events §11.2: MouseEvent creation', () => {
  it.each([true, false])('creates the %s bubbling/cancelable variant from explicit input', (enabled) => {
    const browser = new Browlet({ route: () => '' });
    const element = browser.document.createElement('div');
    const target = unwrap<ElementImpl>(element);
    const input = mouseInput();
    input.modifiers = new EventModifierState({ shiftKey: true, modifierAltGraph: true });

    const event = MouseEventImpl.create(enabled ? 'mousedown' : 'mouseenter', target, enabled, enabled, input);
    const platform = project(event) as MouseEventPlatform;

    expect(platform).toBeInstanceOf(browser.window.MouseEvent);
    expect(platform).not.toBeInstanceOf(browser.window.PointerEvent);
    expect([platform.type, platform.target, platform.view]).toEqual([
      enabled ? 'mousedown' : 'mouseenter', element, browser.window,
    ]);
    expect([event.initialized, platform.bubbles, platform.cancelable, platform.composed, platform.isTrusted])
      .toEqual([true, enabled, enabled, false, false]);
    expect([platform.screenX, platform.screenY, platform.clientX, platform.clientY]).toEqual([12, -13, 4, -6]);
    expect([platform.detail, platform.button, platform.buttons, platform.movementX, platform.movementY])
      .toEqual([0, 0, 5, 0, 0]);
    expect([platform.ctrlKey, platform.shiftKey, platform.altKey, platform.metaKey]).toEqual([false, true, true, false]);
    expect([platform.getModifierState('Alt'), platform.getModifierState('AltGraph')]).toEqual([false, true]);
    expect([platform.relatedTarget, platform.currentTarget, platform.composedPath()]).toEqual([null, null, []]);
    platform.preventDefault();
    expect(platform.defaultPrevented).toBe(enabled);
  });

  it('allocates fresh identities and timestamps through the target environment', () => {
    const browser = new Browlet({ route: () => '' });
    const target = unwrap<ElementImpl>(browser.document.createElement('div'));
    const realm = getRelevantRealm(target);
    const clock = vi.spyOn(realm, 'eventTimeStamp').mockReturnValueOnce(125).mockReturnValueOnce(130);
    try {
      const first = project(MouseEventImpl.create('mousemove', target, true, true, mouseInput())) as MouseEventPlatform;
      const second = project(MouseEventImpl.create('mouseleave', target, false, false, mouseInput())) as MouseEventPlatform;
      expect(first).not.toBe(second);
      expect([first.timeStamp, second.timeStamp]).toEqual([125, 130]);
      expect(getRelevantRealm(first)).toBe(realm);
      expect(getRelevantRealm(second)).toBe(realm);
      expect(clock).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
    }
  });

  it('uses an adopted target\'s current view while preserving its allocation realm', () => {
    const owner = new Browlet({ route: () => '' });
    const other = new Browlet({ route: () => '' });
    const element = owner.document.createElement('div');
    other.document.adoptNode(element);
    const target = unwrap<ElementImpl>(element);
    const platform = project(MouseEventImpl.create('mousedown', target, true, true, mouseInput())) as MouseEventPlatform;
    expect([platform.target, platform.view]).toEqual([element, other.window]);
    expect(getRelevantRealm(platform)).toBe(getRelevantRealm(target));
    expect(platform).toBeInstanceOf(owner.window.MouseEvent);
  });

  it('supports a Window target with the existing view and realm rules', () => {
    const browser = new Browlet({ route: () => '' });
    const realm = getRelevantRealm(browser.window);
    const event = MouseEventImpl.create('mouseup', realm.env.window, true, true, mouseInput());
    const platform = project(event) as MouseEventPlatform;
    expect([platform.target, platform.view]).toEqual([browser.window, browser.window]);
    expect(getRelevantRealm(platform)).toBe(realm);
  });

  it('retains the input snapshot when its producer prepares later input', () => {
    const browser = new Browlet({ route: () => '' });
    const target = unwrap<ElementImpl>(browser.document.createElement('div'));
    const input = mouseInput();
    input.modifiers = new EventModifierState({ ctrlKey: true });
    const event = MouseEventImpl.create('mousemove', target, true, true, input);
    input.clientX = 900;
    input.buttons = 0;
    input.modifiers = new EventModifierState();
    const platform = project(event) as MouseEventPlatform;
    expect([platform.clientX, platform.buttons, platform.ctrlKey]).toEqual([4, 5, true]);
  });

  it('leaves dispatch and trust to the producer and preserves author redispatch rules', () => {
    const browser = new Browlet({ route: () => '' });
    const element = browser.document.createElement('div');
    const target = unwrap<ElementImpl>(element);
    const seen: boolean[] = [];
    element.addEventListener('mousedown', (event) => {
      seen.push(event.isTrusted);
      event.preventDefault();
    });
    const event = MouseEventImpl.create('mousedown', target, true, true, mouseInput());
    expect(seen).toEqual([]);
    event.isTrusted = true;
    expect(target.dispatch(event)).toBe(false);
    element.dispatchEvent(project(event) as MouseEventPlatform);
    expect(seen).toEqual([true, false]);
  });
});

function mouseInput(): MouseEventInput {
  return {
    screenX: 12.75, screenY: -12.25, clientX: 4.5, clientY: -5.5, buttons: 5,
    modifiers: new EventModifierState(),
  };
}
