import { describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { Element, EventTarget, MouseEvent } from '../../../src/browlet/platform';
import type { DocumentImpl, NodeImpl } from '../../../src/browlet/dom/nodes/index';
import { navigationAndTraversalTaskSource } from '../../../src/browlet/scripting/index';
import { PointerEventImpl, type PointerEventInit } from '../../../src/browlet/interaction/events/index';
import { unwrap } from '../../support/browlet-binding';

describe('Pointer Events §10.1: one effective legacy mouse position', () => {
  it('enters only Element ancestors, from outermost to innermost', () => {
    const { update, a, trace } = createFixture();
    update(a);
    expect(trace).toEqual(['mouseover:a:null', 'mouseenter:html:null', 'mouseenter:body:null',
      'mouseenter:left:null', 'mouseenter:a:null']);
  });

  it('returns without allocating notifications when the effective target is unchanged', () => {
    const { update, a, trace } = createFixture();
    update(a);
    trace.length = 0;
    const allocate = vi.spyOn(unwrap<NodeImpl>(a), 'createTrustedEvent');
    update(a);
    expect(allocate).not.toHaveBeenCalled();
    expect(trace).toEqual([]);
  });

  it('leaves inward-to-outward, then enters outward-to-inward', () => {
    const { update, a, b, trace } = createFixture();
    update(a);
    trace.length = 0;
    update(b);
    expect(trace).toEqual(['mouseout:a:b', 'mouseleave:a:b', 'mouseleave:left:b',
      'mouseover:b:a', 'mouseenter:right:a', 'mouseenter:b:a']);
  });

  it('omits shared ancestors when moving between siblings', () => {
    const { update, a, b, left, trace } = createFixture();
    left.append(b);
    update(a);
    trace.length = 0;
    update(b);
    expect(trace).toEqual(['mouseout:a:b', 'mouseleave:a:b', 'mouseover:b:a', 'mouseenter:b:a']);
  });

  it('does not leave an ancestor when entering its descendant, or re-enter it on return', () => {
    const { update, a, left, trace } = createFixture();
    update(left);
    trace.length = 0;
    update(a);
    expect(trace).toEqual(['mouseout:left:a', 'mouseover:a:left', 'mouseenter:a:left']);
    trace.length = 0;
    update(left);
    expect(trace).toEqual(['mouseout:a:left', 'mouseleave:a:left', 'mouseover:left:a']);
  });

  it('leaves the window and does not repeat an outside-to-outside transition', () => {
    const { update, a, trace, mouse } = createFixture();
    update(a);
    trace.length = 0;
    update(null);
    expect(trace).toEqual(['mouseout:a:null', 'mouseleave:a:null', 'mouseleave:left:null',
      'mouseleave:body:null', 'mouseleave:html:null']);
    expect(mouse.target).toBeNull();
    trace.length = 0;
    update(null);
    expect(trace).toEqual([]);
  });

  it('shares one position across primary pointer types and ignores nonprimary input', () => {
    const { update, a, b, trace, mouse } = createFixture();
    update(a, { pointerType: 'mouse', pointerId: 1 });
    trace.length = 0;
    update(b, { pointerType: 'touch', pointerId: 2, isPrimary: false });
    expect(trace).toEqual([]);
    expect(mouse.target).toBe(unwrap(a));
    update(b, { pointerType: 'touch', pointerId: 3 });
    expect(trace[0]).toBe('mouseout:a:b');
    trace.length = 0;
    update(a, { pointerType: 'pen', pointerId: 4 });
    expect(trace[0]).toBe('mouseout:b:a');
    expect(mouse.target).toBe(unwrap(a));
  });

  it('keeps Documents independent and allocates notifications in the target realm', () => {
    const first = createFixture();
    const second = createFixture();
    first.update(first.a);
    first.trace.length = 0;
    const received: MouseEvent[] = [];
    second.a.addEventListener('mouseover', (event) => received.push(event as MouseEvent));
    second.update(second.a);
    expect(second.trace[0]).toBe('mouseover:a:null');
    expect(first.trace).toEqual([]);
    expect(first.mouse).not.toBe(second.mouse);
    expect(first.mouse.target).toBe(unwrap(first.a));
    expect(received[0]).toBeInstanceOf(second.browser.window.MouseEvent);
    expect(received[0]).not.toBeInstanceOf(first.browser.window.MouseEvent);
  });

  it('copies input into fresh trusted MouseEvents with boundary-specific fields and flags', () => {
    const { browser, update, a, b } = createFixture();
    update(a);
    const received: MouseEvent[] = [];
    for (const target of [a, b]) {
      for (const type of ['mouseout', 'mouseleave', 'mouseover', 'mouseenter']) {
        target.addEventListener(type, (event) => received.push(event as MouseEvent));
      }
    }
    const source = update(b, {
      screenX: -2.25, screenY: 7.5, clientX: 5.75, clientY: -1.25,
      button: -1, buttons: 5, detail: 3, movementX: 11, movementY: 12,
      ctrlKey: true, modifierAltGraph: true, modifierCapsLock: true,
    });
    expect(new Set(received).size).toBe(4);
    for (const event of received) {
      const propagates = event.type === 'mouseout' || event.type === 'mouseover';
      expect([event.bubbles, event.cancelable, event.composed]).toEqual([propagates, propagates, propagates]);
      expect(event).toBeInstanceOf(browser.window.MouseEvent);
      expect(event).not.toBeInstanceOf(browser.window.PointerEvent);
      expect(event.isTrusted).toBe(true);
      expect(event.view).toBe(browser.window);
      expect(event.timeStamp).toBe(source.timeStamp);
      expect([event.screenX, event.screenY, event.clientX, event.clientY]).toEqual([-3, 7, 5, -2]);
      expect([event.button, event.buttons, event.detail, event.movementX, event.movementY]).toEqual([0, 5, 0, 0, 0]);
      expect([event.ctrlKey, event.getModifierState('AltGraph'), event.getModifierState('CapsLock')]).toEqual([true, true, true]);
    }
    expect([source.clientX, source.button, source.detail, source.movementX]).toEqual([5.75, -1, 3, 11]);
  });

  it('does not let cancellation suppress the rest of the boundary transition', () => {
    const { update, a, b, trace } = createFixture();
    a.addEventListener('mouseout', (event) => { event.preventDefault(); event.stopPropagation(); });
    b.addEventListener('mouseover', (event) => event.preventDefault());
    update(a);
    trace.length = 0;
    const input = update(b);
    expect(trace).toHaveLength(6);
    expect(trace.at(-1)).toBe('mouseenter:b:a');
    expect(input.defaultPrevented).toBe(false);
  });

  it.each(['mouseout', 'mouseleave', 'mouseover'])('retains both ancestor snapshots after reparenting in %s', (type) => {
    const { update, a, b, destination, trace } = createFixture();
    (type === 'mouseover' ? b : a).addEventListener(type, () => destination.append(b), { once: true });
    update(a);
    trace.length = 0;
    update(b);
    expect(trace).toEqual(['mouseout:a:b', 'mouseleave:a:b', 'mouseleave:left:b',
      'mouseover:b:a', 'mouseenter:right:a', 'mouseenter:b:a']);
  });

  it('lets DOM retarget both targets across a closed shadow root', () => {
    const { update, a, b, right, trace } = createFixture();
    const root = right.attachShadow({ mode: 'closed' });
    root.append(b);
    update(a);
    trace.length = 0;
    update(b);
    expect(trace).toEqual(['mouseout:a:right', 'mouseleave:a:right', 'mouseleave:left:right',
      'mouseover:b:a', 'mouseover:right:a', 'mouseenter:right:a', 'mouseenter:b:a']);
  });

  it('includes assigned slots in flat-tree ancestry', () => {
    const { browser, update, a, b, right, observe, trace } = createFixture();
    const root = right.attachShadow({ mode: 'open' });
    const slot = browser.document.createElement('slot');
    root.append(slot);
    observe(slot, 'slot');
    update(a);
    trace.length = 0;
    update(b);
    expect(trace).toEqual(['mouseout:a:b', 'mouseleave:a:b', 'mouseleave:left:b',
      'mouseover:b:a', 'mouseenter:right:a', 'mouseenter:slot:a', 'mouseenter:b:a']);
  });

  it('repairs to the surviving ancestor immediately and requires a fresh over event', () => {
    const { update, a, left, mouse, trace } = createFixture();
    update(a);
    trace.length = 0;
    a.remove();
    expect(mouse.target).toBe(unwrap(left));
    expect(trace).toEqual([]);
    update(left);
    expect(trace).toEqual(['mouseover:left:left']);
    trace.length = 0;
    update(left);
    expect(trace).toEqual([]);
  });

  it('detects remove/reinsert before the next native input', () => {
    const { update, a, left, mouse, trace } = createFixture();
    update(a);
    a.remove();
    left.append(a);
    expect(mouse.target).toBe(unwrap(left));
    trace.length = 0;
    update(a);
    expect(trace).toEqual(['mouseover:a:left', 'mouseenter:a:left']);
  });

  it('repairs along ancestry at removal time after a state-preserving move', () => {
    const { update, a, destination, mouse, trace } = createFixture();
    update(a);
    destination.moveBefore(a, null);
    trace.length = 0;
    update(a);
    expect(trace).toEqual([]);
    a.remove();
    expect(mouse.target).toBe(unwrap(destination));
    update(destination);
    expect(trace).toEqual(['mouseover:destination:destination']);
  });

  it('repairs when a removed subtree contains the target inside a shadow root', () => {
    const { browser, update, a, left, mouse, trace } = createFixture();
    left.attachShadow({ mode: 'closed' }).append(a);
    update(a);
    left.remove();
    expect(mouse.target).toBe(unwrap(browser.document.body!));
    trace.length = 0;
    update(browser.document.body);
    expect(trace).toEqual(['mouseover:body:body']);
  });

  it('uses the shadow host when the removed target was a direct shadow child', () => {
    const { update, a, left, mouse, trace } = createFixture();
    left.attachShadow({ mode: 'closed' }).append(a);
    update(a);
    a.remove();
    expect(mouse.target).toBe(unwrap(left));
    trace.length = 0;
    update(left);
    expect(trace).toEqual(['mouseover:left:left']);
  });

  it('keeps repairing when surviving ancestors are removed too', () => {
    const { browser, update, a, left, mouse } = createFixture();
    update(a);
    a.remove();
    left.remove();
    expect(mouse.target).toBe(unwrap(browser.document.body!));
    browser.document.body!.remove();
    expect(mouse.target).toBe(unwrap(browser.document.documentElement!));
    browser.document.documentElement!.remove();
    expect(mouse.target).toBe(unwrap(browser.document));
  });

  it('does not lose removal during a boundary listener, even when it reinserts the destination', () => {
    const { update, a, b, right, mouse, trace } = createFixture();
    update(a);
    a.addEventListener('mouseout', () => { b.remove(); right.append(b); }, { once: true });
    update(b);
    expect(mouse.target).toBe(unwrap(right));
    trace.length = 0;
    update(b);
    expect(trace).toEqual(['mouseover:b:right', 'mouseenter:b:right']);
  });

  it('does not allocate compatibility state during unrelated DOM removal', () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const getter = vi.spyOn(document, 'legacyMousePointer', 'get');
    browser.document.body!.remove();
    expect(getter).not.toHaveBeenCalled();
  });

  it('ignores author-dispatched PointerEvents and MouseEvents', () => {
    const { browser, update, a, b, mouse } = createFixture();
    update(a);
    b.dispatchEvent(new browser.window.PointerEvent('pointermove', { isPrimary: true, pointerType: 'mouse' }));
    b.dispatchEvent(new browser.window.MouseEvent('mousemove'));
    expect(mouse.target).toBe(unwrap(a));
  });

  it('releases its target when the owning Document is destroyed', () => {
    const { browser, update, a, mouse } = createFixture();
    const document = unwrap<DocumentImpl>(browser.document);
    update(a);
    document.env.realm.queueGlobalTask(navigationAndTraversalTaskSource, () => { document.destroy(); });
    document.env.responsibleEventLoop.runTaskTurn();
    expect(document.browsingContext).toBeNull();
    expect(mouse.target).toBeNull();
  });
});

/** Real bindings and DOM dispatch; only the future device producer's normalized input is supplied. */
function createFixture() {
  const browser = new Browlet({ route: () => '' });
  const mouse = unwrap<DocumentImpl>(browser.document).legacyMousePointer;
  const trace: string[] = [];
  const labels = new Map<EventTarget, string>();
  const observe = (target: EventTarget, label: string) => {
    labels.set(target, label);
    for (const type of ['mouseout', 'mouseleave', 'mouseover', 'mouseenter']) {
      target.addEventListener(type, (event) => {
        if (event.target !== target) return;
        const related = (event as MouseEvent).relatedTarget;
        trace.push(`${event.type}:${label}:${related === null ? 'null' : labels.get(related)}`);
      });
    }
  };
  const element = (id: string, parent: Element) => {
    const node = browser.document.createElement('div');
    node.id = id;
    parent.append(node);
    observe(node, id);
    return node;
  };
  observe(browser.document, 'document');
  observe(browser.document.documentElement!, 'html');
  observe(browser.document.body!, 'body');
  const left = element('left', browser.document.body!);
  const right = element('right', browser.document.body!);
  const destination = element('destination', browser.document.body!);
  const a = element('a', left);
  const b = element('b', right);
  const update = (target: Element | null, init: PointerEventInit = {}) => {
    const event = new PointerEventImpl('pointermove', { pointerId: 7, pointerType: 'mouse', isPrimary: true, ...init }, 123);
    mouse.updatePosition(event, target === null ? null : unwrap<NodeImpl>(target));
    return event;
  };
  return { browser, mouse, update, observe, trace, a, b, left, right, destination };
}
