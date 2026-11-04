import { describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { HTMLElement } from '../../../src/browlet/platform';
import { BrowsingContext, Navigable } from '../../../src/browlet/browsing/navigation/index';
import { createDocumentState } from '../../../src/browlet/browsing/navigation/state/index';
import type { DocumentImpl, ElementImpl } from '../../../src/browlet/dom/nodes/index';
import type { HTMLIFrameElementImpl } from '../../../src/browlet/dom/nodes/html/embedded/index';
import { DirectManipulation, PanDirection, PointerEventStream, type DirectManipulationLayout } from '../../../src/browlet/interaction/index';
import { PointerEventImpl } from '../../../src/browlet/interaction/events/index';
import { unwrap } from '../../support/browlet-binding';

const { Left, Right, Up, Down } = PanDirection;
const directions = [Left, Right, Up, Down];

describe('Pointer Events §§7.2–7.3: direct-manipulation permissions', () => {
  it.each([
    ['auto', [true, true, true, true], true, true],
    ['none', [false, false, false, false], false, false],
    ['manipulation', [true, true, true, true], true, false],
    ['pan-x', [true, true, false, false], false, false],
    ['pan-y', [false, false, true, true], false, false],
    ['pan-left', [true, false, false, false], false, false],
    ['pan-right', [false, true, false, false], false, false],
    ['pan-up', [false, false, true, false], false, false],
    ['pan-down', [false, false, false, true], false, false],
    ['pinch-zoom', [false, false, false, false], true, false],
    ['pan-left pan-down pinch-zoom', [true, false, false, true], true, false],
    ['pan-x pan-y pinch-zoom', [true, true, true, true], true, false],
  ] as const)('interprets %s without changing its computed value', (value, pans, pinch, multiActivation) => {
    const { snapshot, browser, target } = createFixture(value);
    expect(directions.map((direction) => snapshot().considerPan(direction))).toEqual(pans);
    expect(snapshot().allowsPinchZoom).toBe(pinch);
    expect(snapshot().allowsMultiActivationZoom).toBe(multiActivation);
    expect(browser.window.getComputedStyle(target).touchAction).toBe(value);
  });

  it('freezes rejection when the gesture initially moves along a forbidden axis', () => {
    const { snapshot } = createFixture('pan-y');
    const manipulation = snapshot();
    expect(manipulation.considerPan(Left)).toBe(false);
    expect(manipulation.considerPan(Down)).toBe(false);
  });

  it('permits reversal after a directional start while retaining the axis restriction', () => {
    const { snapshot } = createFixture('pan-left');
    const manipulation = snapshot();
    expect(manipulation.considerPan(Left)).toBe(true);
    expect(manipulation.considerPan(Right)).toBe(true);
    expect(manipulation.considerPan(Down)).toBe(false);
    expect(manipulation.considerPan(Left)).toBe(true);
    expect(snapshot().considerPan(Right)).toBe(false);
  });

  it('ignores subsequent style and custom-property changes, and reads new values for a new contact', () => {
    const { snapshot, target, getLayout } = createFixture('var(--action)');
    target.style.setProperty('--action', 'pan-y pinch-zoom');
    const manipulation = snapshot();
    getLayout.mockClear();
    target.style.setProperty('--action', 'none');
    expect(manipulation.considerPan(Down)).toBe(true);
    expect(manipulation.allowsPinchZoom).toBe(true);
    expect(getLayout).not.toHaveBeenCalled();
    expect(snapshot().considerPan(Down)).toBe(false);
  });

  it('includes the nearest scroll container, but only zoom restrictions above it', () => {
    const { browser, target, snapshot, layouts } = createFixture('pan-x pinch-zoom');
    const parent = browser.document.createElement('section') as HTMLElement;
    browser.document.body!.append(parent);
    parent.append(target);
    parent.style.touchAction = 'pan-x pinch-zoom';
    layouts.set(unwrap(parent), { isScrollContainer: true });
    browser.document.body!.style.touchAction = 'none';
    const manipulation = snapshot();
    expect(manipulation.considerPan(Left)).toBe(true);
    expect(manipulation.allowsPinchZoom).toBe(false);
    parent.style.touchAction = 'none';
    expect(snapshot().considerPan(Left)).toBe(false);
  });

  it('stops pan restrictions at the target when it is itself the scroll container', () => {
    const { browser, target, snapshot, layouts } = createFixture('pan-y');
    layouts.set(unwrap(target), { isScrollContainer: true });
    browser.document.body!.style.touchAction = 'none';
    expect(snapshot().considerPan(Down)).toBe(true);
  });

  it('checks ancestor restrictions even though touch-action is not inherited', () => {
    const { browser, target, snapshot } = createFixture('auto');
    browser.document.body!.style.touchAction = 'none';
    expect(browser.window.getComputedStyle(target).touchAction).toBe('auto');
    expect(snapshot().considerPan(Down)).toBe(false);
    expect(snapshot().allowsPinchZoom).toBe(false);
  });

  it('ignores values on boxes where the property does not apply', () => {
    const { target, snapshot, layouts } = createFixture('none');
    layouts.set(unwrap(target), { applies: false });
    const manipulation = snapshot();
    expect(manipulation.considerPan(Left)).toBe(true);
    expect(manipulation.allowsPinchZoom).toBe(true);
  });

  it('checks each applicable element in its own coordinate space and freezes that mapping', () => {
    const { target, snapshot, layouts } = createFixture('pan-left');
    // A quarter-turn: viewport down is local left. This is supplied layout, not guessed geometry.
    const rotated = { [Left]: Up, [Right]: Down, [Up]: Right, [Down]: Left };
    const toLocalPanDirection = vi.fn((direction: PanDirection) => rotated[direction]);
    layouts.set(unwrap(target), { toLocalPanDirection });
    const manipulation = snapshot();
    expect(toLocalPanDirection).toHaveBeenCalledTimes(4);
    layouts.set(unwrap(target), { toLocalPanDirection: (direction) => direction });
    toLocalPanDirection.mockClear();
    expect(manipulation.considerPan(Down)).toBe(true);
    expect(manipulation.considerPan(Up)).toBe(true);
    expect(manipulation.considerPan(Left)).toBe(false);
    expect(toLocalPanDirection).not.toHaveBeenCalled();
    expect(snapshot().considerPan(Down)).toBe(false);
  });

  it('intersects differently oriented ancestors instead of transforming an already-intersected value', () => {
    const { browser, target, snapshot, layouts } = createFixture('pan-x');
    browser.document.body!.style.touchAction = 'pan-y';
    layouts.set(unwrap(target), {
      toLocalPanDirection: (direction) => ({ [Left]: Up, [Right]: Down, [Up]: Right, [Down]: Left })[direction],
    });
    expect(snapshot().considerPan(Down)).toBe(true);
    expect(snapshot().considerPan(Left)).toBe(false);
  });

  // Stylelet's existing shadow-scope selection stub is the missing owner dependency.
  // Keep the required behavior asserted; Eric approved this expected failure.
  it.fails('follows slot and shadow-host ancestry', () => {
    const { browser, target, snapshot, getLayout } = createFixture('auto');
    const host = browser.document.createElement('div') as HTMLElement;
    browser.document.body!.append(host);
    host.append(target);
    const shadow = host.attachShadow({ mode: 'open' });
    const slot = browser.document.createElement('slot') as HTMLElement;
    slot.style.touchAction = 'pan-y';
    shadow.append(slot);
    host.style.touchAction = 'pan-x';
    expect(snapshot().considerPan(Down)).toBe(false);
    expect(getLayout.mock.calls.map(([element]) => element)).toContain(unwrap(slot));
    expect(getLayout.mock.calls.map(([element]) => element)).toContain(unwrap(host));
  });

  it('carries zoom restrictions across a frame boundary without importing its pan restrictions', () => {
    const { browser, getLayout } = createFixture('auto');
    const parent = unwrap<DocumentImpl>(browser.document);
    const container = parent.createElement('iframe') as HTMLIFrameElementImpl;
    parent.body!.appendChild(container);
    const [, child] = BrowsingContext.createTopLevel(parent.env.userAgent);
    // Child startup remains unfinished; connect the real retained navigable association.
    container.contentNavigable = new Navigable(createDocumentState(child), parent.getNodeNavigable());
    container.setAttribute('style', 'touch-action: none');
    const target = child.createElement('div');
    child.body!.appendChild(target);
    const manipulation = new DirectManipulation(target, getLayout);
    expect(manipulation.considerPan(Left)).toBe(true);
    expect(manipulation.allowsPinchZoom).toBe(false);
    expect(getLayout.mock.calls.map(([element]) => element)).toContain(container);
    expect(getLayout.mock.calls.map(([element]) => element)).toContain(parent.documentElement);
  });

  it('does not invent layout facts when the required owner cannot provide them', () => {
    const { target } = createFixture('none');
    expect(() => new DirectManipulation(unwrap(target), () => { throw new Error('Layout unavailable'); }))
      .toThrow('Layout unavailable');
  });

  it('uses the pre-dispatch snapshot before canceling the stream for viewport takeover', () => {
    const { target, snapshot } = createFixture('auto');
    const manipulation = snapshot();
    const targetImpl = unwrap<ElementImpl>(target);
    const hitTest = () => targetImpl;
    const stream = new PointerEventStream(7, true, false, () => false);
    const canceled = vi.fn();
    target.addEventListener('pointercancel', canceled);
    target.addEventListener('pointerdown', (event) => {
      target.style.touchAction = 'none';
      event.preventDefault();
    });
    const event = targetImpl.createTrustedEvent(PointerEventImpl) as PointerEventImpl;
    event.pointerType = 'touch';
    event.buttons = 1;
    const selected = stream.prepareTarget('pointerdown', event, hitTest);
    expect(stream.dispatchToTarget(event, selected, () => null, 1)).toBe(false);
    expect(manipulation.considerPan(Down)).toBe(true);
    expect(stream.suppressForDirectManipulation(hitTest)).toBe(true);
    expect(canceled).toHaveBeenCalledOnce();
    expect(snapshot().considerPan(Down)).toBe(false);
  });
});

/** Real DOM, CSS parsing/defaulting, computed values, and bindings; only missing layout facts are supplied. */
function createFixture(value: string) {
  const browser = new Browlet({ route: () => '' });
  const target = browser.document.createElement('div') as HTMLElement;
  browser.document.body!.append(target);
  target.style.touchAction = value;
  const layouts = new Map<ElementImpl, Partial<DirectManipulationLayout>>();
  const getLayout = vi.fn((element: ElementImpl): DirectManipulationLayout => ({
    applies: true,
    isScrollContainer: false,
    toLocalPanDirection: (direction) => direction,
    ...layouts.get(element),
  }));
  const snapshot = () => new DirectManipulation(unwrap(target), getLayout);
  return { browser, target, layouts, getLayout, snapshot };
}
