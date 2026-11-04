import { describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { Element, PointerEvent } from '../../../src/browlet/platform';
import type { DocumentImpl, ElementImpl } from '../../../src/browlet/dom/nodes/index';
import type { HTMLIFrameElementImpl } from '../../../src/browlet/dom/nodes/html/embedded/index';
import { BrowsingContext, Navigable, TopLevelTraversable } from '../../../src/browlet/browsing/navigation/index';
import { DocumentState } from '../../../src/browlet/browsing/navigation/state/index';
import { PointerEventStream } from '../../../src/browlet/interaction/index';
import { PointerEventImpl, type PointerInputEventType } from '../../../src/browlet/interaction/events/index';
import { project, unwrap } from '../../support/browlet-binding';

describe('Pointer Events §4: Element capture methods', () => {
  it('exposes the methods on Element and its HTML, SVG, and MathML descendants', async () => {
    const { browser } = createFixture();
    expect(await browser.evaluate(() => {
      const html = document.createElement('div');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      const math = document.createElementNS('http://www.w3.org/1998/Math/MathML', 'mi');
      return ['setPointerCapture', 'releasePointerCapture', 'hasPointerCapture'].map((name) => {
        const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, name)!;
        const method = descriptor.value as (...args: unknown[]) => unknown;
        return [typeof method, method.length, descriptor.enumerable,
          descriptor.writable, descriptor.configurable, Object.hasOwn(HTMLElement.prototype, name),
          typeof Reflect.get(html, name), typeof Reflect.get(svg, name), typeof Reflect.get(math, name)];
      });
    })).toEqual(Array.from({ length: 3 }, () => ['function', 1, true, true, true, false, 'function', 'function', 'function']));
  });

  it('rejects unknown IDs before checking connectivity or Pointer Lock, with realm-owned errors', () => {
    const { browser, a, hasLockedElement } = createFixture();
    a.remove();
    for (const method of ['setPointerCapture', 'releasePointerCapture'] as const) {
      let error: unknown;
      try { a[method](999); } catch (caught) { error = caught; }
      expect(error instanceof browser.window.DOMException).toBe(true);
      expect(error).toMatchObject({ name: 'NotFoundError' });
    }
    expect(a.hasPointerCapture(999)).toBe(false);
    expect(hasLockedElement).not.toHaveBeenCalled();
  });

  it('rejects a disconnected target for a known ID before querying Pointer Lock', () => {
    const { a, hasLockedElement } = createFixture();
    a.remove();
    expect(() => a.setPointerCapture(7)).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
    expect(hasLockedElement).not.toHaveBeenCalled();
    expect(a.releasePointerCapture(7)).toBeUndefined();
    expect(a.hasPointerCapture(7)).toBe(false);
  });

  it('does nothing for an unpressed active pointer, but still performs the earlier lock check', () => {
    const { a, send, hasLockedElement } = createFixture();
    send('pointermove', a, 0);
    expect(a.setPointerCapture(7)).toBeUndefined();
    expect(a.hasPointerCapture(7)).toBe(false);
    expect(hasLockedElement).toHaveBeenCalledOnce();
    hasLockedElement.mockReturnValue(true);
    expect(() => a.setPointerCapture(7)).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
  });

  it('exposes pending capture immediately, replaces it, and only releases the requesting element', () => {
    const { a, b, send, stream, notifications } = createFixture();
    send('pointerdown', a, 1);
    a.setPointerCapture(7);
    expect(a.hasPointerCapture(7)).toBe(true);
    expect(stream.capture.targetOverride).toBeNull();
    expect(notifications).toEqual([]);
    b.releasePointerCapture(7);
    expect(a.hasPointerCapture(7)).toBe(true);
    b.setPointerCapture(7);
    expect([a.hasPointerCapture(7), b.hasPointerCapture(7)]).toEqual([false, true]);
    send('pointermove', a, 1);
    expect(notifications).toEqual(['gotpointercapture:b']);
    b.releasePointerCapture(7);
    expect(b.hasPointerCapture(7)).toBe(false);
    expect(stream.capture.targetOverride).toBe(unwrap(b));
    expect(notifications).toEqual(['gotpointercapture:b']);
    send('pointermove', a, 1);
    expect(notifications).toEqual(['gotpointercapture:b', 'lostpointercapture:b']);
  });

  it('lets a down listener request capture using current buttons without host-side intervention', () => {
    const { a, b, send } = createFixture();
    const seen: boolean[] = [];
    a.addEventListener('pointerdown', (event) => {
      a.setPointerCapture((event as PointerEvent).pointerId);
      seen.push(a.hasPointerCapture(7));
    });
    send('pointerdown', a, 1);
    expect(seen).toEqual([true]);
    expect(project(send('pointermove', b, 1).target!)).toBe(a);
  });

  it('exposes implicit capture during down and permits its immediate release', () => {
    const { a, b, send, stream, notifications } = createFixture();
    stream.isDirectManipulation = true;
    const seen: boolean[] = [];
    a.addEventListener('pointerdown', () => {
      seen.push(a.hasPointerCapture(7));
      a.releasePointerCapture(7);
      seen.push(a.hasPointerCapture(7));
    });
    send('pointerdown', a, 1);
    expect(seen).toEqual([true, false]);
    expect(project(send('pointermove', b, 1).target!)).toBe(b);
    expect(notifications).toEqual([]);
  });

  it('updates released buttons before both capture notifications and the up listener', () => {
    const { a, b, send, stream } = createFixture();
    const seen: unknown[] = [];
    a.addEventListener('pointerdown', () => a.setPointerCapture(7));
    a.addEventListener('gotpointercapture', () => {
      b.setPointerCapture(7);
      seen.push(['gain', stream.buttons, a.hasPointerCapture(7), b.hasPointerCapture(7)]);
    });
    a.addEventListener('pointerup', () => {
      a.releasePointerCapture(7);
      a.setPointerCapture(7);
      seen.push(['up', stream.buttons, a.hasPointerCapture(7)]);
    });
    send('pointerdown', a, 1);
    send('pointerup', b, 0);
    expect(seen).toEqual([['gain', 0, true, false], ['up', 0, false]]);
    expect(a.hasPointerCapture(7)).toBe(false);
    expect(stream.capture.targetOverride).toBeNull();
  });

  it('uses Web IDL long conversion exactly once and preserves conversion failures', () => {
    const { a, send } = createFixture();
    send('pointerdown', a, 1);
    const valueOf = vi.fn(() => 2 ** 32 + 7.9);
    a.setPointerCapture({ valueOf } as unknown as number);
    expect(valueOf).toHaveBeenCalledOnce();
    expect(a.hasPointerCapture(2 ** 32 + 7)).toBe(true);
    a.releasePointerCapture(7.9);
    expect(a.hasPointerCapture(7)).toBe(false);
    const error = new Error('conversion failed');
    expect(() => a.hasPointerCapture({ valueOf: () => { throw error; } } as unknown as number)).toThrow(error);
  });

  it('enforces receiver branding, required arguments, and numeric conversion at Binding', async () => {
    const { browser } = createFixture();
    expect(await browser.evaluate(() => {
      return ['setPointerCapture', 'releasePointerCapture', 'hasPointerCapture'].map((name) => {
        const method = Reflect.get(Element.prototype, name) as (...args: unknown[]) => unknown;
        return [[{}, 7], [document.body], [document.body, 1n], [document.body, Symbol()]].map((args) => {
          try { Reflect.apply(method, args[0], args.slice(1)); return 'no error'; }
          catch (error) { return error instanceof TypeError; }
        });
      });
    })).toEqual([[true, true, true, true], [true, true, true, true], [true, true, true, true]]);
  });

  it('uses the receiver context even for a method borrowed from another Window', () => {
    const { browser, a, send } = createFixture();
    const other = new Browlet({ route: () => '' });
    send('pointerdown', a, 1);
    other.window.Element.prototype.setPointerCapture.call(a, 7);
    expect(browser.window.Element.prototype.hasPointerCapture.call(a, 7)).toBe(true);
    other.window.Element.prototype.releasePointerCapture.call(a, 7);
    expect(a.hasPointerCapture(7)).toBe(false);
  });

  it('shares IDs with child documents but only lets the active document set capture', () => {
    const { browser, a, send, stream, top } = createFixture();
    const parentDocument = unwrap<DocumentImpl>(browser.document);
    const container = parentDocument.createElement('iframe') as HTMLIFrameElementImpl;
    parentDocument.body!.appendChild(container);
    const [, child] = BrowsingContext.createTopLevel(parentDocument.env.userAgent);
    // Child creation remains unfinished; use the same retained association as the stream tests.
    container.contentNavigable = new Navigable(DocumentState.create(child), parentDocument.getNodeNavigable());
    const childImpl = child.createElement('div');
    child.body!.appendChild(childImpl);
    const target = project(childImpl) as Element;
    expect(child.getNodeNavigable()!.topLevelTraversable).toBe(top);
    send('pointerdown', a, 1);
    a.setPointerCapture(7);
    expect(target.setPointerCapture(7)).toBeUndefined();
    expect(target.hasPointerCapture(7)).toBe(false);
    target.releasePointerCapture(7);
    expect(a.hasPointerCapture(7)).toBe(true);
    a.releasePointerCapture(7);
    send('pointermove', target, 1);
    target.setPointerCapture(7);
    expect(target.hasPointerCapture(7)).toBe(true);
    expect(stream.activeDocument).toBe(child);
    expect(a.setPointerCapture(7)).toBeUndefined();
    expect(target.hasPointerCapture(7)).toBe(true);
  });

  it('isolates IDs between top-level contexts sharing one UserAgent', () => {
    const { browser, a, send, top } = createFixture();
    const doc = unwrap<DocumentImpl>(browser.document);
    const otherTop = TopLevelTraversable.create(doc.env.userAgent, null, 'other');
    const otherDocument = otherTop.activeDocument!;
    const otherImpl = otherDocument.createElement('div');
    otherDocument.body!.appendChild(otherImpl);
    const other = project(otherImpl) as Element;
    send('pointerdown', a, 1);
    a.setPointerCapture(7);
    expect(() => other.setPointerCapture(7)).toThrow(expect.objectContaining({ name: 'NotFoundError' }));
    const otherStream = new PointerEventStream(7, false, true, () => false);
    otherTop.pointerEventStreams.set(7, otherStream);
    otherStream.prepareTarget('pointerdown', new PointerEventImpl('', { buttons: 1 }), () => otherImpl);
    other.setPointerCapture(7);
    expect([a.hasPointerCapture(7), other.hasPointerCapture(7)]).toEqual([true, true]);
    expect(top.pointerEventStreams.get(7)).not.toBe(otherStream);
  });

  it('returns no capture and ignores requests for a document without a browsing context', () => {
    const { browser } = createFixture();
    const inert = browser.document.implementation.createHTMLDocument().body!;
    expect(inert.setPointerCapture(999)).toBeUndefined();
    expect(inert.releasePointerCapture(999)).toBeUndefined();
    expect(inert.hasPointerCapture(999)).toBe(false);
  });

  it('does not manufacture an active ID from author construction or dispatch', async () => {
    const { browser, top } = createFixture();
    expect(await browser.evaluate(() => {
      const target = document.body;
      target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 999, buttons: 1 }));
      try { target.setPointerCapture(999); return 'no error'; }
      catch (error) { return (error as DOMException).name; }
    })).toBe('NotFoundError');
    expect(top.pointerEventStreams.has(999)).toBe(false);
  });

  it('forgets an ID when its producer retires the stream after final notifications', () => {
    const { a, send, top } = createFixture();
    send('pointerdown', a, 1);
    a.setPointerCapture(7);
    send('pointerup', a, 0);
    top.pointerEventStreams.delete(7);
    expect(a.hasPointerCapture(7)).toBe(false);
    expect(() => a.releasePointerCapture(7)).toThrow(expect.objectContaining({ name: 'NotFoundError' }));
  });

  it('preserves pending capture when the required Pointer Lock owner rejects or is unavailable', () => {
    const { a, b, send, hasLockedElement } = createFixture();
    send('pointerdown', a, 1);
    a.setPointerCapture(7);
    hasLockedElement.mockReturnValue(true);
    expect(() => b.setPointerCapture(7)).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
    expect(a.hasPointerCapture(7)).toBe(true);
    hasLockedElement.mockImplementation(() => { throw new Error('Pointer Lock unavailable'); });
    expect(() => b.setPointerCapture(7)).toThrow('Pointer Lock unavailable');
    expect(a.hasPointerCapture(7)).toBe(true);
  });
});

/** Register one active stream explicitly; only input delivery and the Pointer Lock query are supplied by tests. */
function createFixture() {
  const browser = new Browlet({ route: () => '' });
  const document = unwrap<DocumentImpl>(browser.document);
  const top = document.getNodeNavigable()!.topLevelTraversable;
  const a = browser.document.createElement('div');
  const b = browser.document.createElement('div');
  a.id = 'a';
  b.id = 'b';
  browser.document.body!.append(a, b);
  const hasLockedElement = vi.fn((_document: DocumentImpl) => false);
  const stream = new PointerEventStream(7, false, true, hasLockedElement);
  top.pointerEventStreams.set(7, stream);
  const notifications: string[] = [];
  for (const type of ['gotpointercapture', 'lostpointercapture']) {
    browser.document.addEventListener(type, (event) => notifications.push(`${type}:${(event.target as Element).id}`));
  }
  const send = (type: PointerInputEventType, hit: Element, buttons: number) => {
    const input = new PointerEventImpl(type, { buttons, pointerType: 'mouse' });
    const target = stream.prepareTarget(type, input, () => unwrap<ElementImpl>(hit));
    const event = target.createTrustedEvent(PointerEventImpl) as PointerEventImpl;
    event.copyInputFrom(input);
    event.setPointerEventAttributes(type);
    stream.dispatchToTarget(event, target, () => unwrap<ElementImpl>(hit), 1);
    return event;
  };
  return { browser, a, b, stream, top, send, notifications, hasLockedElement };
}
