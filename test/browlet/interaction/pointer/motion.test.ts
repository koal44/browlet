import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import type { Element, PointerEvent } from '../../../../src/browlet/platform';
import type { ElementImpl } from '../../../../src/browlet/dom/nodes/index';
import { PointerEventStream } from '../../../../src/browlet/interaction/index';
import { PointerEventImpl, type PointerEventInit, type PointerInputEventType } from '../../../../src/browlet/interaction/events/index';
import { unwrap } from '../../../support/browlet-binding';

describe('Pointer Events §§3.3.4–3.3.7: motion and release', () => {
  it('keeps secure raw delivery noncancelable and avoids repeating its boundaries for the next move', async () => {
    const { send, a, b, events } = await createFixture();
    send('pointermove', a);
    events.length = 0;
    b.addEventListener('pointerrawupdate', (event) => event.preventDefault());
    b.addEventListener('pointermove', (event) => event.preventDefault());

    expect(send('pointerrawupdate', b, { clientX: 30.5 }).accepted).toBe(true);
    expect(events.map((event) => `${event.type}:${(event.target as Element).id}`)).toEqual([
      'pointerout:a', 'pointerleave:a', 'pointerover:b', 'pointerenter:b', 'pointerrawupdate:b',
    ]);
    const raw = events.at(-1)!;
    expect(raw).toMatchObject({
      bubbles: true, cancelable: false, composed: true, isTrusted: true,
      defaultPrevented: false, clientX: 30.5, pointerId: 7,
    });
    events.length = 0;
    expect(send('pointermove', b, { clientX: 30.5 }).accepted).toBe(false);
    expect(events.map((event) => event.type)).toEqual(['pointermove']);
  });

  it('does not deliver or retain raw input in an insecure target document', async () => {
    const { stream, send, a, b, events } = await createFixture(false);
    send('pointermove', a, { clientX: 10, pressure: 0.25 });
    events.length = 0;
    expect(send('pointerrawupdate', b, { clientX: 90, pressure: 0.75 }).accepted).toBe(true);
    expect(events).toEqual([]);
    expect(stream.previousTarget).toBe(unwrap(a));

    stream.suppress(() => unwrap<ElementImpl>(a));
    expect(events.find((event) => event.type === 'pointercancel')).toMatchObject({ clientX: 10, pressure: 0.25 });
  });

  it('does not start a stream from a suppressed raw update', async () => {
    const { stream, send, a, events } = await createFixture(false);
    send('pointerrawupdate', a, { clientX: 90, pressure: 0.75 });
    stream.suppress(() => unwrap<ElementImpl>(a));
    expect(events).toEqual([]);
    expect(stream.previousTarget).toBeNull();
    expect(stream.activeDocument).toBeNull();
  });

  it('processes pending capture before secure raw delivery', async () => {
    const { stream, send, a, b, events } = await createFixture();
    send('pointermove', a);
    stream.setPointerCapture(unwrap<ElementImpl>(a), 1);
    events.length = 0;
    send('pointerrawupdate', b, { pressure: 0.6 });
    expect(events.map((event) => [event.type, event.target, event.pressure])).toEqual([
      ['gotpointercapture', a, 0.6], ['pointerrawupdate', a, 0.6],
    ]);
    expect(stream.capture.targetOverride).toBe(unwrap(a));
  });

  it('cancels from the last dispatched raw input even after author reinitialization', async () => {
    const { stream, send, a, events } = await createFixture();
    send('pointermove', a, { clientX: 10, pressure: 0.25 });
    send('pointerrawupdate', a, { clientX: 20, pressure: 0.75, tiltX: 15 });
    const raw = events.at(-1)!;
    raw.initMouseEvent('author', false, false, null, 0, 0, 0, 999, 999, false, false, false, false, 0, null);
    events.length = 0;
    stream.suppress(() => unwrap<ElementImpl>(a));
    expect(events[0]).toMatchObject({ type: 'pointercancel', clientX: 20, pressure: 0.75, tiltX: 15 });
  });

  it('zeros up pressure before capture processing, release, and non-hover exit', async () => {
    const { stream, send, a, events } = await createFixture();
    stream.isDirectManipulation = true;
    send('pointerdown', a, { pointerType: 'touch', pressure: 0.8 });
    events.length = 0;
    send('pointerup', a, { pointerType: 'touch', buttons: 0, pressure: 0.8 });
    expect(events.map((event) => [event.type, event.pressure])).toEqual([
      ['gotpointercapture', 0], ['pointerup', 0], ['lostpointercapture', 0], ['pointerout', 0], ['pointerleave', 0],
    ]);
  });

  it('preserves author-supplied up pressure and permits synthetic raw dispatch in insecure contexts', async () => {
    const { browser } = await createFixture(false);
    expect(await browser.evaluate(() => {
      const up = new PointerEvent('pointerup', { pressure: 0.8 });
      const raw = new PointerEvent('pointerrawupdate', { cancelable: true });
      let calls = 0;
      document.addEventListener('pointerrawupdate', (event) => {
        calls++;
        event.preventDefault();
      });
      document.dispatchEvent(up);
      const accepted = document.dispatchEvent(raw);
      return [isSecureContext, up.pressure, up.isTrusted, calls, accepted, raw.defaultPrevented, raw.isTrusted];
    })).toEqual([false, Math.fround(0.8), false, 1, false, true, false]);
  });
});

/** Real allocation and dispatch; the test supplies normalized input, hit targets, and an unlocked document. */
async function createFixture(secure = true) {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate(`${secure ? 'https' : 'http'}://pointer.test/`);
  const a = browser.document.createElement('div');
  const b = browser.document.createElement('div');
  a.id = 'a';
  b.id = 'b';
  browser.document.body!.append(a, b);
  const stream = new PointerEventStream(7, false, true, () => false);
  const events: PointerEvent[] = [];
  for (const type of ['pointerover', 'pointerenter', 'pointerout', 'pointerleave', 'pointerdown',
    'pointermove', 'pointerrawupdate', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture']) {
    browser.document.addEventListener(type, (event) => {
      if (event.target === a || event.target === b) events.push(event as PointerEvent);
    }, true);
  }
  const send = (type: PointerInputEventType, hit: Element, init: PointerEventInit = {}) => {
    const input = new PointerEventImpl(type, { pointerType: 'pen', buttons: 1, button: -1, ...init });
    const target = stream.prepareTarget(type, input, () => unwrap<ElementImpl>(hit));
    const event = target.createTrustedEvent(PointerEventImpl);
    event.copyInputFrom(input);
    event.setPointerEventAttributes(type);
    return { event, accepted: stream.dispatchToTarget(event, target, () => null, 1) };
  };
  return { browser, stream, send, a, b, events };
}
