import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { Element } from '../../../src/browlet/platform';
import type { DocumentImpl, ElementImpl } from '../../../src/browlet/dom/nodes/index';
import { PointerEventStream } from '../../../src/browlet/interaction/index';
import { PointerEventImpl } from '../../../src/browlet/interaction/events/index';
import { unwrap } from '../../support/browlet-binding';

describe('Pointer Events §8.5: capture during DOM removal', () => {
  it('clears pending capture immediately, even if the target is reinserted before another input', () => {
    const { browser, a, b, send, notifications } = createFixture();
    send(a);
    a.setPointerCapture(7);
    a.remove();
    expect(a.hasPointerCapture(7)).toBe(false);
    browser.document.body!.append(a);
    expect(send(b).target).toBe(unwrap(b));
    expect(notifications).toEqual([]);
  });

  it('clears capture held by a descendant when its ancestor is removed and reinserted', () => {
    const { browser, a, b, send } = createFixture();
    const parent = browser.document.createElement('section');
    browser.document.body!.append(parent);
    parent.append(a);
    send(a);
    a.setPointerCapture(7);
    send(a);
    parent.remove();
    expect(a.hasPointerCapture(7)).toBe(false);
    browser.document.body!.append(parent);
    expect(send(b).target).toBe(unwrap(b));
  });

  it('defers loss until the next input and targets the reconnected element', () => {
    const { browser, a, b, send, notifications } = createFixture();
    send(a);
    a.setPointerCapture(7);
    send(a);
    notifications.length = 0;
    a.remove();
    expect(notifications).toEqual([]);
    browser.document.body!.append(a);
    expect(send(b).target).toBe(unwrap(b));
    expect(notifications).toEqual(['lostpointercapture:a']);
    send(b);
    expect(notifications).toEqual(['lostpointercapture:a']);
  });

  it('targets the Document if the effective target stays disconnected', () => {
    const { a, b, send, notifications } = createFixture();
    send(a);
    a.setPointerCapture(7);
    send(a);
    notifications.length = 0;
    a.remove();
    expect(notifications).toEqual([]);
    send(b);
    expect(notifications).toEqual(['lostpointercapture:#document']);
  });

  it('preserves a connected replacement request when the effective target is removed', () => {
    const { a, b, send, notifications } = createFixture();
    send(a);
    a.setPointerCapture(7);
    send(a);
    b.setPointerCapture(7);
    notifications.length = 0;
    a.remove();
    expect(b.hasPointerCapture(7)).toBe(true);
    expect(send(b).target).toBe(unwrap(b));
    expect(notifications).toEqual(['lostpointercapture:#document', 'gotpointercapture:b']);
  });

  it('clears every disconnected pending target, including targets in a removed shadow tree', () => {
    const { browser, a, b, send, top, stream } = createFixture();
    const host = browser.document.createElement('div');
    browser.document.body!.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.append(a, b);
    const otherStream = new PointerEventStream(8, false, () => false);
    top.pointerEventStreams.set(8, otherStream);
    send(a);
    send(b, otherStream);
    a.setPointerCapture(7);
    b.setPointerCapture(8);
    host.remove();
    expect(a.hasPointerCapture(7)).toBe(false);
    expect(b.hasPointerCapture(8)).toBe(false);
    browser.document.body!.append(host);
    // DOM retargets the completed event to the host; inspect the stream's actual delivery target.
    send(b);
    expect(stream.previousTarget).toBe(unwrap(b));
    send(a, otherStream);
    expect(otherStream.previousTarget).toBe(unwrap(a));
  });

  it('retains the in-progress capture snapshot when a loss listener removes and reinserts its destination', () => {
    const { browser, a, b, send, notifications } = createFixture();
    send(a);
    a.setPointerCapture(7);
    send(a);
    a.addEventListener('lostpointercapture', () => {
      b.remove();
      browser.document.body!.append(b);
    }, { once: true });
    b.setPointerCapture(7);
    notifications.length = 0;
    expect(send(a).target).toBe(unwrap(b));
    expect(b.hasPointerCapture(7)).toBe(false);
    expect(notifications).toEqual(['lostpointercapture:a', 'gotpointercapture:b']);
    expect(send(a).target).toBe(unwrap(a));
    expect(notifications).toEqual(['lostpointercapture:a', 'gotpointercapture:b', 'lostpointercapture:b']);
  });

  it('releases on the following input when a gain listener removes and reinserts its target', () => {
    const { browser, a, b, send, notifications } = createFixture();
    send(a);
    a.addEventListener('gotpointercapture', () => {
      a.remove();
      browser.document.body!.append(a);
    }, { once: true });
    a.setPointerCapture(7);
    expect(send(b).target).toBe(unwrap(a));
    expect(a.hasPointerCapture(7)).toBe(false);
    expect(notifications).toEqual(['gotpointercapture:a']);
    expect(send(b).target).toBe(unwrap(b));
    expect(notifications).toEqual(['gotpointercapture:a', 'lostpointercapture:a']);
  });

  it('keeps an independent top-level context\'s capture request intact', () => {
    const first = createFixture();
    const second = createFixture();
    first.send(first.a);
    second.send(second.a);
    first.a.setPointerCapture(7);
    second.a.setPointerCapture(7);
    first.a.remove();
    expect(first.a.hasPointerCapture(7)).toBe(false);
    expect(second.a.hasPointerCapture(7)).toBe(true);
    expect(second.send(second.b).target).toBe(unwrap(second.a));
  });

  it('preserves capture across a state-preserving moveBefore', () => {
    const { browser, a, b, send, notifications } = createFixture();
    send(a);
    a.setPointerCapture(7);
    send(a);
    notifications.length = 0;
    browser.document.body!.moveBefore(a, null);
    expect(a.hasPointerCapture(7)).toBe(true);
    expect(send(b).target).toBe(unwrap(a));
    expect(notifications).toEqual([]);
  });
});

/** Real DOM mutations and capture bindings, with an explicitly registered active input stream. */
function createFixture() {
  const browser = new Browlet({ route: () => '' });
  const document = unwrap<DocumentImpl>(browser.document);
  const top = document.getNodeNavigable()!.topLevelTraversable;
  const stream = new PointerEventStream(7, false, () => false);
  top.pointerEventStreams.set(7, stream);
  const a = browser.document.createElement('div');
  const b = browser.document.createElement('div');
  a.id = 'a';
  b.id = 'b';
  browser.document.body!.append(a, b);
  const notifications: string[] = [];
  for (const type of ['gotpointercapture', 'lostpointercapture']) {
    browser.document.addEventListener(type, (event) => {
      const label = event.target === browser.document ? '#document' : (event.target as Element).id;
      notifications.push(`${type}:${label}`);
    });
  }
  const send = (hit: Element, inputStream = stream) => {
    const input = new PointerEventImpl('', { pointerType: 'mouse', buttons: 1 });
    const target = inputStream.prepareTarget('pointermove', input, () => unwrap<ElementImpl>(hit));
    const event = target.createTrustedEvent(PointerEventImpl) as PointerEventImpl;
    event.copyInputFrom(input);
    event.setPointerEventAttributes('pointermove');
    inputStream.dispatchToTarget(event, target, () => unwrap<ElementImpl>(hit));
    return event;
  };
  return { browser, a, b, send, notifications, stream, top };
}
