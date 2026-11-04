import { InternalError } from '../../infra/index';
import { TouchActionValue } from '../../stylelet/index';

import type { ElementImpl, NodeImpl } from '../dom/nodes/index';

/** Touch-action permissions frozen at contact, with one retained decision about starting a pan. */
// https://w3c.github.io/pointerevents/#determining-supported-direct-manipulation-behavior
// The input producer owns one snapshot per contact, captured before its boundary
// and pointerdown listeners. Gesture recognition and actual scrolling/zooming belong to that
// producer and the viewport owner, not to this permission calculation.
export class DirectManipulation {
  /** Initial directions permitted by every applicable element through the nearest scroller. */
  #initialPan = allPanDirections;
  /** The same axis constraints, allowing reversal after an accepted initial direction. */
  #continuedPan = allPanDirections;
  /** Null until the recognizer supplies its first pan direction; rejection lasts for this contact. */
  #panning: boolean | null = null;
  /** Zoom restrictions include applicable ancestors above the nearest scroller. */
  #allowsPinchZoom = true;
  /** Only auto permits timed multi-activation gestures such as double-tap zoom. */
  #allowsMultiActivationZoom = true;

  // TODO(Pointer Events §7.2 / layout): the producer must supply actual box
  // applicability, CSS Overflow §2 scroll containers, and element-local direction
  // mapping. There are no untransformed/block-box defaults for missing layout.
  constructor(target: ElementImpl, getLayout: (element: ElementImpl) => DirectManipulationLayout) {
    let considerPanning = true;
    for (let node: NodeImpl | null = target; node !== null;) {
      if (node.isElement()) {
        const layout = getLayout(node);
        if (layout.applies) {
          // TODO(CSSOM computed styles / CSS Scoping): Stylelet's query throws
          // until it can select each shadow scope during matching and inheritance.
          const value = node.nodeDocument.getStyleEngine().getComputedStyle(node)
            .computedStyle?.get('touch-action')?.value.inner;
          if (!(value instanceof TouchActionValue)) {
            throw new InternalError('Direct manipulation requires a computed touch-action value');
          }
          this.#restrict(value, layout, considerPanning);
        }
        // Include the scroller's own restriction, then stop considering pan ancestors.
        if (layout.isScrollContainer) considerPanning = false;
      }
      if (node.isDocument()) {
        considerPanning = false;
        // SPEC_CLASH(touch-action-frame-zoom): Follow §7.2 and Blink across frames for zoom; §7.1 says touch-action does not cross embedded contexts.
        node = node.getNodeNavigable()?.container ?? null;
      } else {
        node = node.getFlatTreeParent();
      }
    }
  }

  /** Each contact in multi-finger panning/zooming must permit it; grouping contacts is producer work. */
  // https://compat.spec.whatwg.org/#touch-action
  get allowsPinchZoom(): boolean {
    return this.#allowsPinchZoom;
  }

  get allowsMultiActivationZoom(): boolean {
    return this.#allowsMultiActivationZoom;
  }

  /**
   * Decide whether a recognized pan in viewport coordinates may start or continue. The first call
   * fixes acceptance for this contact. An accepted pan may reverse, but cannot
   * move along an axis excluded by the frozen touch-action restrictions.
   */
  // https://w3c.github.io/pointerevents/#details-of-touch-action-values
  // Direction recognition (including thresholds and diagonal gestures) is an
  // input-owner decision. Directions describe scrolling: pan-left moves the
  // scroll position left, with the finger moving right (confirmed in Chromium).
  considerPan(direction: PanDirection): boolean {
    if (this.#panning === null) this.#panning = (this.#initialPan & direction) !== 0;
    return this.#panning && (this.#continuedPan & direction) !== 0;
  }

  /** Read each value once; neither style objects nor live layout queries survive capture. */
  #restrict(value: TouchActionValue, layout: DirectManipulationLayout, considerPanning: boolean): void {
    let pan = 0;
    let pinchZoom = false;
    let multiActivationZoom = false;
    for (const keyword of value.repr) {
      switch (keyword) {
        case 'auto': multiActivationZoom = true; pan = allPanDirections; pinchZoom = true; break;
        case 'manipulation': pan = allPanDirections; pinchZoom = true; break;
        case 'pan-x': pan |= PanDirection.Left | PanDirection.Right; break;
        case 'pan-y': pan |= PanDirection.Up | PanDirection.Down; break;
        case 'pan-left': pan |= PanDirection.Left; break;
        case 'pan-right': pan |= PanDirection.Right; break;
        case 'pan-up': pan |= PanDirection.Up; break;
        case 'pan-down': pan |= PanDirection.Down; break;
        case 'pinch-zoom': pinchZoom = true; break;
      }
    }
    this.#allowsPinchZoom &&= pinchZoom;
    this.#allowsMultiActivationZoom &&= multiActivationZoom;
    if (!considerPanning) return;

    const continuedPan = ((pan & (PanDirection.Left | PanDirection.Right)) !== 0 ? PanDirection.Left | PanDirection.Right : 0) |
      ((pan & (PanDirection.Up | PanDirection.Down)) !== 0 ? PanDirection.Up | PanDirection.Down : 0);
    for (const direction of panDirections) {
      const localDirection = layout.toLocalPanDirection(direction);
      if ((pan & localDirection) === 0) this.#initialPan &= ~direction;
      if ((continuedPan & localDirection) === 0) this.#continuedPan &= ~direction;
    }
  }
}

/** One scrolling direction selected by gesture recognition, also used as an internal permission bit. */
export enum PanDirection {
  Left = 1,
  Right = 2,
  Up = 4,
  Down = 8,
}

/** Required facts from layout and gesture recognition, supplied for each element at contact. */
export type DirectManipulationLayout = {
  /** Excludes non-replaced inline boxes and table rows/row groups/columns/column groups (§7.1). */
  applies: boolean;
  /** CSS Overflow §2's scroll container, even when currently unable to scroll in a particular direction. */
  isScrollContainer: boolean;
  /** Map a recognized viewport pan direction into this element's coordinate space, including transforms. */
  toLocalPanDirection: (direction: PanDirection) => PanDirection;
};

const panDirections = [PanDirection.Left, PanDirection.Right, PanDirection.Up, PanDirection.Down];
const allPanDirections = PanDirection.Left | PanDirection.Right | PanDirection.Up | PanDirection.Down;
