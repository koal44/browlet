import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import type { DocumentImpl, ElementImpl } from '../../../../src/browlet/dom/nodes/index';
import { PointerEventImpl, type PointerEventType } from '../../../../src/browlet/interaction/events/index';
import type { PointerEvent as PointerEventPlatform } from '../../../../src/browlet/platform';
import { getRelevantRealm, project, unwrap } from '../../../support/browlet-binding';

describe('Pointer Events §3.1.3.1: internal event attributes', () => {
  it.each([
    ['pointerover', true, true, true], ['pointerenter', false, false, false],
    ['pointerdown', true, true, true], ['pointermove', true, true, true],
    ['pointerrawupdate', true, false, true], ['pointerup', true, true, true],
    ['pointercancel', true, false, true], ['pointerout', true, true, true],
    ['pointerleave', false, false, false], ['gotpointercapture', true, false, true],
    ['lostpointercapture', true, false, true],
  ] satisfies [PointerEventType, boolean, boolean, boolean][])(
    'delivers %s with its specified flags and cancellation behavior', (type, bubbles, cancelable, composed) => {
      const browser = new Browlet({ route: () => '' });
      const realm = getRelevantRealm(browser.window);
      let observed: unknown;
      browser.window.addEventListener(type, (value) => {
        const event = value as PointerEventPlatform;
        event.preventDefault();
        observed = [event instanceof browser.window.PointerEvent, event.type, event.bubbles,
          event.cancelable, event.composed, event.detail, event.isTrusted, event.defaultPrevented,
          event.target === browser.window, getRelevantRealm(event) === realm];
      });
      const uncanceled = realm.env.window.fireEvent(type, PointerEventImpl, (event) => {
        event.bubbles = !bubbles;
        event.cancelable = !cancelable;
        event.composed = !composed;
        event.detail = 9;
        event.setPointerEventAttributes(type);
      });
      expect(observed).toEqual([true, type, bubbles, cancelable, composed, 0, true, cancelable, true, true]);
      expect(uncanceled).toBe(!cancelable);
    },
  );

  it.each(['pointerover', 'pointerout', 'pointerenter', 'pointerleave', 'gotpointercapture', 'lostpointercapture'] as const)(
    'retains the supplied related target for %s', (type) => {
      const browser = new Browlet({ route: () => '' });
      const other = browser.document.createElement('div');
      const event = new PointerEventImpl('before', { relatedTarget: unwrap<ElementImpl>(other) });
      event.setPointerEventAttributes(type);
      expect(event.type).toBe(type);
      expect(event.relatedTarget).toBe(unwrap(other));
    },
  );

  it.each(['pointerdown', 'pointermove', 'pointerrawupdate', 'pointerup', 'pointercancel'] as const)(
    'clears unrelated boundary data from %s', (type) => {
      const browser = new Browlet({ route: () => '' });
      const event = new PointerEventImpl('before', { relatedTarget: unwrap<DocumentImpl>(browser.document) });
      event.setPointerEventAttributes(type);
      expect(event.relatedTarget).toBeNull();
    },
  );

  it('preserves supplied samples, modifiers, coordinates, view, and timing without registering a pointer', () => {
    const browser = new Browlet({ route: () => '' });
    const sample = new browser.window.PointerEvent('sample');
    const platform = new browser.window.PointerEvent('before', {
      pointerId: 12, pointerType: 'pen', isPrimary: true, buttons: 5, button: 1,
      screenX: 15.5, clientY: -2.25, pressure: 0.5, tiltX: 30, ctrlKey: true,
      view: browser.window, detail: 7, predictedEvents: [sample],
    });
    const event = unwrap<PointerEventImpl>(platform);
    const timeStamp = platform.timeStamp;
    event.setPointerEventAttributes('gotpointercapture');
    expect([platform.pointerId, platform.pointerType, platform.isPrimary, platform.buttons, platform.button,
      platform.screenX, platform.clientY, platform.pressure, platform.tiltX, platform.ctrlKey,
      platform.view === browser.window, platform.timeStamp === timeStamp, platform.isTrusted])
      .toEqual([12, 'pen', true, 5, 1, 15.5, -2.25, 0.5, 30, true, true, true, false]);
    expect(platform.getPredictedEvents()[0]).toBe(sample);
    expect(getRelevantRealm(browser.window).env.userAgent.activePointers.activate('pen').isPrimary).toBe(true);
  });

  it('uses the prepared bubbling/composed flags through shadow dispatch', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.evaluate(() => {
      const host = document.createElement('div');
      host.id = 'host';
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: 'open' });
      const child = document.createElement('span');
      shadow.appendChild(child);
      const received: string[] = [];
      Reflect.set(window, 'received', received);
      for (const type of ['pointerover', 'pointerenter']) {
        child.addEventListener(type, () => received.push(`${type}:child`));
        shadow.addEventListener(type, () => received.push(`${type}:shadow`));
        host.addEventListener(type, (event) => received.push(`${type}:host:${event.target === host}`));
        document.addEventListener(type, () => received.push(`${type}:document`));
      }
    });
    const child = unwrap<ElementImpl>(browser.document.getElementById('host')!.shadowRoot!.firstElementChild!);
    for (const type of ['pointerover', 'pointerenter'] as const) {
      child.fireEvent(type, PointerEventImpl, (event) => event.setPointerEventAttributes(type));
    }
    expect(await browser.evaluate(() => Reflect.get(window, 'received') as string[])).toEqual([
      'pointerover:child', 'pointerover:shadow', 'pointerover:host:true', 'pointerover:document', 'pointerenter:child',
    ]);
  });

  it('does not apply native defaults to author construction or redispatch', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const ordinary = new PointerEvent('pointerdown');
      const custom = new PointerEvent('pointerrawupdate', {
        bubbles: false, cancelable: true, composed: false, detail: 8, relatedTarget: document.body,
      });
      document.addEventListener('pointerrawupdate', (event) => event.preventDefault());
      const result = document.dispatchEvent(custom);
      return [[ordinary.bubbles, ordinary.cancelable, ordinary.composed], result,
        [custom.bubbles, custom.cancelable, custom.composed, custom.detail,
          custom.relatedTarget === document.body, custom.isTrusted, custom.defaultPrevented]];
    })).toEqual([[false, false, false], false, [false, true, false, 8, true, false, true]]);

    const realm = getRelevantRealm(browser.window);
    const internal = realm.env.createEvent(PointerEventImpl);
    internal.setPointerEventAttributes('pointerdown');
    const platform = project(internal) as PointerEventPlatform;
    expect(platform.isTrusted).toBe(true);
    browser.document.dispatchEvent(platform);
    expect([platform.bubbles, platform.cancelable, platform.composed, platform.detail, platform.isTrusted])
      .toEqual([true, true, true, 0, false]);
  });
});
