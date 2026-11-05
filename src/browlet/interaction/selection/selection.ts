import {
  arg, defineDictionary, defineInterface, dictMember, DOMExceptionImpl, DOMExceptionNames,
  emptyDictionary, emptySequence, idlType, impl, integer, nullable, op, reference, roAttr, sequence,
} from '../../../web-idl/core/index';

import { AbstractRangeImpl, RangeImpl, StaticRangeImpl } from '../../dom/ranges/index';
import type { DocumentImpl, NodeImpl, ShadowRootImpl } from '../../dom/nodes/index';
import type { DOMEnvironment } from '../../dom/environment';

/** The Document's selected Range and composed endpoints, independent of input and painting. */
// https://w3c.github.io/selection-api/#definition
export class SelectionImpl {
  env: DOMEnvironment;
  /** Document owning this selection, including its notification task. */
  #document: DocumentImpl;
  /** Selected Range identity, with both association directions cleared on removal. */
  #range: RangeImpl | null = null;
  /** Direction survives script changes to the selected Range's boundary points. */
  #direction: SelectionDirection = 'none';
  /** Last observed public Range endpoints, used to suppress unchanged notifications. */
  #boundaries: SelectionBoundaries | null = null;
  /** Only cross-root selections need two additional, unprojected live endpoints. */
  #composed: ComposedSelection | null = null;

  constructor(document: DocumentImpl) {
    this.env = document.env;
    this.#document = document;
  }

  // SPEC_CLASH(selection-shadow-endpoints): Expose live endpoints in this Document's shadow trees like Chromium/Firefox; the getter prose hides non-document-tree endpoints.
  // https://w3c.github.io/selection-api/#dom-selection-anchornode
  get anchorNode(): NodeImpl | null {
    return (this.#direction === 'forward' ? this.#range?.startContainer : this.#range?.endContainer) ?? null;
  }

  // https://w3c.github.io/selection-api/#dom-selection-anchoroffset
  get anchorOffset(): number {
    return (this.#direction === 'forward' ? this.#range?.startOffset : this.#range?.endOffset) ?? 0;
  }

  // https://w3c.github.io/selection-api/#dom-selection-focusnode
  get focusNode(): NodeImpl | null {
    return (this.#direction === 'forward' ? this.#range?.endContainer : this.#range?.startContainer) ?? null;
  }

  // https://w3c.github.io/selection-api/#dom-selection-focusoffset
  get focusOffset(): number {
    return (this.#direction === 'forward' ? this.#range?.endOffset : this.#range?.startOffset) ?? 0;
  }

  // https://w3c.github.io/selection-api/#dom-selection-iscollapsed
  get isCollapsed(): boolean { return this.#range === null || this.#range.collapsed; }

  // https://w3c.github.io/selection-api/#dom-selection-rangecount
  get rangeCount(): number { return this.#range === null ? 0 : 1; }

  // https://w3c.github.io/selection-api/#dom-selection-type
  get type(): string { return this.#range === null ? 'None' : this.#range.collapsed ? 'Caret' : 'Range'; }

  // SPEC_CLASH(selection-collapsed-direction): Preserve direction when the existing Range collapses as the draft and WebKit do; Chromium/Firefox report none while collapsed.
  // https://w3c.github.io/selection-api/#dom-selection-direction
  get direction(): SelectionDirection { return this.#direction; }

  /** Return the exact selected Range rather than a snapshot. */
  // https://w3c.github.io/selection-api/#dom-selection-getrangeat
  getRangeAt(index: number): RangeImpl {
    if (index !== 0 || this.#range === null) throw new DOMExceptionImpl('', DOMExceptionNames.indexSize);
    return this.#range;
  }

  /** Attach an ordinary-document Range only while the selection is empty. */
  // https://w3c.github.io/selection-api/#dom-selection-addrange
  addRange(range: RangeImpl): void {
    if (range.startContainer.getRoot() !== this.#document) return;
    // SPEC_CLASH(selection-single-range): Keep the draft's single range like Chromium/WebKit; Firefox also accepts additional ranges.
    if (this.#range !== null) return;
    // SPEC_GAP(selection-add-direction): addRange omits direction initialization; use forward, as all three browsers do for a noncollapsed added Range.
    this.#replaceRange(range, 'forward');
  }

  /** Only the associated Range's identity can remove it. */
  // https://w3c.github.io/selection-api/#dom-selection-removerange
  removeRange(range: RangeImpl): void {
    if (range !== this.#range) throw new DOMExceptionImpl('', DOMExceptionNames.notFound);
    this.removeAllRanges();
  }

  // https://w3c.github.io/selection-api/#dom-selection-removeallranges
  removeAllRanges(): void {
    if (this.#range === null) return;
    // Sever the Range-to-Selection link before releasing our selected Range.
    this.#range.setSelection(null);
    this.#detachComposed();
    this.#range = null;
    this.#boundaries = null;
    this.#direction = 'none';
    this.#document.scheduleSelectionChange();
  }

  // https://w3c.github.io/selection-api/#dom-selection-empty
  empty(): void { this.removeAllRanges(); }

  /** Snapshot the selection, enclosing shadow hosts whose roots were not supplied. */
  // https://w3c.github.io/selection-api/#dom-selection-getcomposedranges
  getComposedRanges(options: GetComposedRangesOptions): StaticRangeImpl[] {
    const range = this.#range;
    if (range === null) return [];
    let { startContainer, startOffset, endContainer, endOffset } = this.#composed?.boundaries ?? range;
    let startRoot = startContainer.getRoot();
    // A supplied inner shadow root also permits exposure of its enclosing roots.
    while (startRoot.isShadowRoot() &&
      !options.shadowRoots.some((root) => root.hasShadowIncludingInclusiveAncestor(startRoot))) {
      startOffset = startRoot.host.getIndex();
      // Selection membership guarantees that each enclosing host is connected.
      startContainer = startRoot.host.parentNode!;
      startRoot = startContainer.getRoot();
    }
    let endRoot = endContainer.getRoot();
    while (endRoot.isShadowRoot() &&
      !options.shadowRoots.some((root) => root.hasShadowIncludingInclusiveAncestor(endRoot))) {
      endOffset = endRoot.host.getIndex() + 1;
      endContainer = endRoot.host.parentNode!;
      endRoot = endContainer.getRoot();
    }
    return [new StaticRangeImpl({ startContainer, startOffset, endContainer, endOffset }, this.env)];
  }

  /** Replace the selected Range with a caret, or clear the selection for null. */
  // https://w3c.github.io/selection-api/#dom-selection-collapse
  collapse(node: NodeImpl | null, offset: number): void {
    if (node === null) {
      this.removeAllRanges();
      return;
    }
    if (node.isDocumentType()) throw new DOMExceptionImpl('', DOMExceptionNames.invalidNodeType);
    if (offset > node.getLength()) throw new DOMExceptionImpl('', DOMExceptionNames.indexSize);
    if (!node.hasShadowIncludingInclusiveAncestor(this.#document)) return;
    this.#setCollapsedRange(node, offset);
  }

  // https://w3c.github.io/selection-api/#dom-selection-setposition
  setPosition(node: NodeImpl | null, offset: number): void { this.collapse(node, offset); }

  // https://w3c.github.io/selection-api/#dom-selection-collapsetostart
  collapseToStart(): void {
    if (this.#range === null) throw new DOMExceptionImpl('', DOMExceptionNames.invalidState);
    this.#setCollapsedRange(this.#range.startContainer, this.#range.startOffset);
  }

  // https://w3c.github.io/selection-api/#dom-selection-collapsetoend
  collapseToEnd(): void {
    if (this.#range === null) throw new DOMExceptionImpl('', DOMExceptionNames.invalidState);
    this.#setCollapsedRange(this.#range.endContainer, this.#range.endOffset);
  }

  /** Keep the anchor and replace the Range with a new focus, reversing direction when needed. */
  // https://w3c.github.io/selection-api/#dom-selection-extend
  extend(node: NodeImpl, offset: number): void {
    // SPEC_CLASH(selection-extend-validation): Follow the draft/Chromium's membership-first order; Firefox/WebKit check for an empty selection first.
    if (!node.hasShadowIncludingInclusiveAncestor(this.#document)) return;
    if (this.#range === null) throw new DOMExceptionImpl('', DOMExceptionNames.invalidState);
    if (node.isDocumentType()) throw new DOMExceptionImpl('', DOMExceptionNames.invalidNodeType);
    if (offset > node.getLength()) throw new DOMExceptionImpl('', DOMExceptionNames.indexSize);
    // SPEC_GAP(selection-composed-extend): The draft does not distinguish the ordinary anchor from a separate composed anchor.
    // SPEC_CLASH(selection-composed-extend): Keep the exposed ordinary anchor and replace the span; Chromium uses a hidden anchor and Firefox can retain the composed span.
    const anchorNode = this.anchorNode!;
    const anchorOffset = this.anchorOffset;
    if (anchorNode.getRoot() !== node.getRoot()) {
      // SPEC_CLASH(selection-extend-root): The draft and Chromium/Firefox collapse at the new focus; WebKit keeps a composed span across roots.
      // SPEC_GAP(selection-extend-root-direction): The final comparison has no shared root; reuse directionless collapse, like Chromium/Firefox.
      this.#setCollapsedRange(node, offset);
      return;
    }
    this.#setAnchorAndFocus(anchorNode, anchorOffset, node, offset);
  }

  /** Replace the selected Range and direction, retaining a composed span across roots. */
  // https://w3c.github.io/selection-api/#dom-selection-setbaseandextent
  setBaseAndExtent(anchorNode: NodeImpl, anchorOffset: number, focusNode: NodeImpl, focusOffset: number): void {
    // SPEC_CLASH(selection-base-extent-validation): Browsers validate each point's node kind before its offset; the draft checks both offsets before node kinds in Range setters.
    if (anchorNode.isDocumentType()) throw new DOMExceptionImpl('', DOMExceptionNames.invalidNodeType);
    if (anchorOffset > anchorNode.getLength()) throw new DOMExceptionImpl('', DOMExceptionNames.indexSize);
    if (focusNode.isDocumentType()) throw new DOMExceptionImpl('', DOMExceptionNames.invalidNodeType);
    if (focusOffset > focusNode.getLength()) throw new DOMExceptionImpl('', DOMExceptionNames.indexSize);
    if (!anchorNode.hasShadowIncludingInclusiveAncestor(this.#document) ||
      !focusNode.hasShadowIncludingInclusiveAncestor(this.#document)) return;
    if (anchorNode.getRoot() !== focusNode.getRoot()) {
      this.#setBaseAndExtentAcrossRoots(anchorNode, anchorOffset, focusNode, focusOffset);
      return;
    }
    this.#setAnchorAndFocus(anchorNode, anchorOffset, focusNode, focusOffset);
  }

  /** Receive live-boundary changes; DOM adjustments retain the separate composed span. */
  // https://w3c.github.io/selection-api/#selectionchange-event
  rangeChanged(range: RangeImpl, fromMutation = false): void {
    const composed = this.#composed;
    if (range !== this.#range && range !== composed?.start && range !== composed?.end) return;
    let changed = false;
    if (range === this.#range) {
      if (!fromMutation) {
        // SPEC_GAP(selection-composed-range-edit): The draft omits how ordinary Range edits affect the extra composed span.
        // SPEC_CLASH(selection-composed-range-edit): Replace that span on any explicit Range edit. Chromium updates one composed endpoint; Firefox often retains the old span.
        // Even a same-value setter explicitly selects the ordinary Range. Automatic
        // DOM adjustments instead keep both hidden endpoints alive independently.
        changed = composed !== null;
        this.#detachComposed();
        if (!this.checkDocument()) return;
      }
      const previous = this.#boundaries!;
      changed = !sameBoundaries(previous, range) || changed;
      copyBoundaries(previous, range);
    } else if (composed !== null) {
      const previous = composed.boundaries;
      changed = previous.startContainer !== composed.start.startContainer ||
        previous.startOffset !== composed.start.startOffset ||
        previous.endContainer !== composed.end.startContainer || previous.endOffset !== composed.end.startOffset;
      previous.startContainer = composed.start.startContainer;
      previous.startOffset = composed.start.startOffset;
      previous.endContainer = composed.end.startContainer;
      previous.endOffset = composed.end.startOffset;
    }
    // A DOM mutation can adjust the three Ranges in any order. Do not rewrite one
    // from another inside that loop, or apply membership checks during a move's
    // temporary unlink. Document's completed removal checks membership separately.
    // SPEC_CLASH(selection-unchanged-boundaries): Notify actual endpoint changes, as the draft/Chromium/WebKit do; Firefox also notifies same-value setters.
    if (changed) this.#document.scheduleSelectionChange();
  }

  /** Clear invalid membership, including either end of a composed span. */
  checkDocument(): boolean {
    // SPEC_CLASH(selection-range-document): Clear when the Range leaves this Document, like Chromium/Firefox; the draft retains it and hides its endpoints, while WebKit can retain an earlier snapshot.
    if (this.#range !== null && (this.#range.startContainer.getShadowIncludingRoot() !== this.#document ||
      (this.#composed !== null && (this.#composed.start.startContainer.getShadowIncludingRoot() !== this.#document ||
        this.#composed.end.startContainer.getShadowIncludingRoot() !== this.#document)))) {
      this.removeAllRanges();
    }
    return this.#range !== null;
  }

  /** Reorder retained composed endpoints after a completed state-preserving DOM move. */
  // SPEC_GAP(selection-composed-move): The draft does not define how a move reversing endpoints affects composed selection state.
  // SPEC_CLASH(selection-composed-move): Preserve the supplied anchor/focus points; Chromium/Firefox lose or repair part of the probed span.
  updateAfterMove(): void {
    const composed = this.#composed;
    if (composed === null || !this.checkDocument()) return;
    const { start, end } = composed;
    if (compareComposedPoints(start.startContainer, start.startOffset, end.startContainer, end.startOffset) !== 1) return;
    composed.start = end;
    composed.end = start;
    composed.boundaries.startContainer = end.startContainer;
    composed.boundaries.startOffset = end.startOffset;
    composed.boundaries.endContainer = start.startContainer;
    composed.boundaries.endOffset = start.startOffset;
    // Their ordered roles reverse, but the originally supplied anchor/focus survive.
    this.#direction = this.#direction === 'forward' ? 'backward' : 'forward';
    // All DOM Range adjustments have finished. Keep the public identity and move
    // its caret to the new later endpoint without treating this as an author edit.
    const range = this.#range!;
    range.setSelection(null);
    range.setStart(start.startContainer, start.startOffset);
    range.collapse(true);
    range.setSelection(this);
    copyBoundaries(this.#boundaries!, range);
    this.#document.scheduleSelectionChange();
  }

  #setCollapsedRange(node: NodeImpl, offset: number): void {
    const range = new RangeImpl(this.#document, this.env);
    range.setStart(node, offset);
    range.collapse(true);
    // SPEC_GAP(selection-collapse-direction): The collapse algorithms omit direction initialization; use none for the new collapsed selection.
    // SPEC_CLASH(selection-collapse-direction): Chromium/Firefox use none after Selection collapse; WebKit uses forward. Mutating an existing Range still preserves its direction.
    this.#replaceRange(range, 'none');
  }

  #setAnchorAndFocus(anchorNode: NodeImpl, anchorOffset: number, focusNode: NodeImpl, focusOffset: number): void {
    const backward = AbstractRangeImpl.compareBoundaryPoints(anchorNode, anchorOffset, focusNode, focusOffset) === 1;
    const range = new RangeImpl(this.#document, this.env);
    if (backward) {
      range.setStart(focusNode, focusOffset);
      range.setEnd(anchorNode, anchorOffset);
    } else {
      range.setStart(anchorNode, anchorOffset);
      range.setEnd(focusNode, focusOffset);
    }
    // SPEC_CLASH(selection-equal-points-direction): Both algorithms and WebKit use forward for equal points; Chromium/Firefox expose none.
    this.#replaceRange(range, backward ? 'backward' : 'forward');
  }

  // SPEC_GAP(selection-base-extent-roots): The draft compares points in different roots without defining an order; retain a separate composed span as browsers do.
  #setBaseAndExtentAcrossRoots(
    anchorNode: NodeImpl, anchorOffset: number, focusNode: NodeImpl, focusOffset: number,
  ): void {
    const backward = compareComposedPoints(anchorNode, anchorOffset, focusNode, focusOffset) === 1;
    const start = new RangeImpl(this.#document, this.env);
    start.setStart(backward ? focusNode : anchorNode, backward ? focusOffset : anchorOffset);
    start.collapse(true);
    const end = new RangeImpl(this.#document, this.env);
    end.setStart(backward ? anchorNode : focusNode, backward ? anchorOffset : focusOffset);
    end.collapse(true);
    const range = new RangeImpl(this.#document, this.env);
    // Chromium/Firefox expose an ordinary Range collapsed at the later point;
    // only getComposedRanges exposes both endpoints. Range keeps its DOM invariants.
    range.setStart(end.startContainer, end.startOffset);
    range.collapse(true);
    // SPEC_CLASH(selection-composed-type): Keep type based on this ordinary Range, as Firefox does; Chromium reports Range for the separate composed span.
    this.#replaceRange(range, backward ? 'backward' : 'forward', {
      start, end,
      boundaries: {
        startContainer: start.startContainer, startOffset: start.startOffset,
        endContainer: end.startContainer, endOffset: end.startOffset,
      },
    });
  }

  #replaceRange(range: RangeImpl, direction: SelectionDirection, composed: ComposedSelection | null = null): void {
    const previous = this.#boundaries;
    const previousComposed = this.#composed;
    // SPEC_CLASH(selection-unchanged-replacement): All browsers suppress unchanged replacements; §6.2 schedules for every new Range association.
    const changed = previous === null || this.#direction !== direction || !sameBoundaries(previous, range) ||
      (previousComposed === null ? composed !== null : composed === null ||
        !sameBoundaries(previousComposed.boundaries, composed.boundaries));
    this.#range?.setSelection(null);
    this.#detachComposed();
    this.#range = range;
    this.#direction = direction;
    this.#boundaries = {
      startContainer: range.startContainer, startOffset: range.startOffset,
      endContainer: range.endContainer, endOffset: range.endOffset,
    };
    this.#composed = composed;
    range.setSelection(this);
    composed?.start.setSelection(this);
    composed?.end.setSelection(this);
    if (changed) this.#document.scheduleSelectionChange();
  }

  #detachComposed(): void {
    this.#composed?.start.setSelection(null);
    this.#composed?.end.setSelection(null);
    this.#composed = null;
  }

  // TODO(Selection API §3): selectAllChildren, modify,
  // deleteFromDocument, containsNode, and stringification are not exposed yet.
  // TODO(§§2, 6 / input and rendering owners): user selection, selectstart,
  // focus/editing policy, and caret/highlight painting need their concrete producers.
}

export interface GetComposedRangesOptions {
  shadowRoots: ShadowRootImpl[];
}

type SelectionDirection = 'none' | 'forward' | 'backward';

interface SelectionBoundaries {
  startContainer: NodeImpl;
  startOffset: number;
  endContainer: NodeImpl;
  endOffset: number;
}

interface ComposedSelection {
  start: RangeImpl;
  end: RangeImpl;
  boundaries: SelectionBoundaries;
}

// SPEC_CLASH(selection-composed-order): Follow Chromium/WebKit's shadow-host order; Firefox applies slot redistribution in the probed cross-root case.
// A shadow tree precedes its host's light children. The host's offset zero is
// before that tree; a positive host offset is after it. Ordinary points retain
// DOM's boundary ordering, including parent offsets on either side of a host.
function compareComposedPoints(nodeA: NodeImpl, offsetA: number, nodeB: NodeImpl, offsetB: number): -1 | 0 | 1 {
  if (nodeA.getRoot() === nodeB.getRoot()) {
    return AbstractRangeImpl.compareBoundaryPoints(nodeA, offsetA, nodeB, offsetB);
  }
  const ancestors = (node: NodeImpl): NodeImpl[] => {
    const result = [];
    for (let current: NodeImpl | null = node; current !== null;
      current = current.parentNode ?? (current.isShadowRoot() ? current.host : null)) result.push(current);
    return result;
  };
  const chainA = ancestors(nodeA);
  const chainB = ancestors(nodeB);
  let indexA = chainA.length - 1;
  let indexB = chainB.length - 1;
  while (indexA >= 0 && indexB >= 0 && chainA[indexA] === chainB[indexB]) { indexA--; indexB--; }
  if (indexA < 0) {
    const child = chainB[indexB]!;
    return child.isShadowRoot() ? offsetA === 0 ? -1 : 1 : child.getIndex() < offsetA ? 1 : -1;
  }
  if (indexB < 0) {
    const child = chainA[indexA]!;
    return child.isShadowRoot() ? offsetB === 0 ? 1 : -1 : child.getIndex() < offsetB ? -1 : 1;
  }
  const childA = chainA[indexA]!;
  const childB = chainB[indexB]!;
  if (childA.isShadowRoot()) return -1;
  if (childB.isShadowRoot()) return 1;
  // These are distinct ordinary children of the shared shadow-including ancestor.
  return childA.getIndex() < childB.getIndex() ? -1 : 1;
}

function sameBoundaries(a: SelectionBoundaries, b: SelectionBoundaries): boolean {
  return a.startContainer === b.startContainer && a.startOffset === b.startOffset &&
    a.endContainer === b.endContainer && a.endOffset === b.endOffset;
}

function copyBoundaries(target: SelectionBoundaries, source: SelectionBoundaries): void {
  target.startContainer = source.startContainer;
  target.startOffset = source.startOffset;
  target.endContainer = source.endContainer;
  target.endOffset = source.endOffset;
}

/*
 * [Exposed=Window]
 * interface Selection {
 *   readonly attribute Node? anchorNode;
 *   readonly attribute unsigned long anchorOffset;
 *   readonly attribute Node? focusNode;
 *   readonly attribute unsigned long focusOffset;
 *   readonly attribute boolean isCollapsed;
 *   readonly attribute unsigned long rangeCount;
 *   readonly attribute DOMString type;
 *   readonly attribute DOMString direction;
 *   Range getRangeAt(unsigned long index);
 *   undefined addRange(Range range);
 *   undefined removeRange(Range range);
 *   undefined removeAllRanges();
 *   undefined empty();
 *   sequence<StaticRange> getComposedRanges(optional GetComposedRangesOptions options = {});
 *   undefined collapse(Node? node, optional unsigned long offset = 0);
 *   undefined setPosition(Node? node, optional unsigned long offset = 0);
 *   undefined collapseToStart();
 *   undefined collapseToEnd();
 *   undefined extend(Node node, optional unsigned long offset = 0);
 *   undefined setBaseAndExtent(Node anchorNode, unsigned long anchorOffset, Node focusNode, unsigned long focusOffset);
 *   // Remaining §3 members are the next bounded slice.
 * };
 */
export const selectionIDL = defineInterface({
  name: 'Selection', exposed: 'Window', implementation: impl(SelectionImpl),
  members: [
    roAttr('anchorNode', nullable(reference('Node'))),
    roAttr('anchorOffset', idlType.unsignedLong),
    roAttr('focusNode', nullable(reference('Node'))),
    roAttr('focusOffset', idlType.unsignedLong),
    roAttr('isCollapsed', idlType.boolean),
    roAttr('rangeCount', idlType.unsignedLong),
    roAttr('type', idlType.DOMString),
    roAttr('direction', idlType.DOMString),
    op('getRangeAt', reference('Range'), [arg('index', idlType.unsignedLong)]),
    op('addRange', idlType.undefined, [arg('range', reference('Range'))]),
    op('removeRange', idlType.undefined, [arg('range', reference('Range'))]),
    op('removeAllRanges', idlType.undefined),
    op('empty', idlType.undefined),
    // SPEC_CLASH(selection-snapshot-array-realm): Keep Binding's receiver-realm array like Chromium/WebKit; Firefox uses the borrowed method's realm.
    op('getComposedRanges', sequence(reference('StaticRange')), [
      arg('options', reference('GetComposedRangesOptions'), { optional: true, default: emptyDictionary }),
    ]),
    op('collapse', idlType.undefined, [
      arg('node', nullable(reference('Node'))),
      arg('offset', idlType.unsignedLong, { optional: true, default: integer(0) }),
    ]),
    op('setPosition', idlType.undefined, [
      arg('node', nullable(reference('Node'))),
      arg('offset', idlType.unsignedLong, { optional: true, default: integer(0) }),
    ]),
    op('collapseToStart', idlType.undefined),
    op('collapseToEnd', idlType.undefined),
    op('extend', idlType.undefined, [
      arg('node', reference('Node')),
      arg('offset', idlType.unsignedLong, { optional: true, default: integer(0) }),
    ]),
    // SPEC_CLASH(selection-base-extent-null): Follow the draft and Firefox/WebKit's non-null Node arguments; Chromium still accepts null.
    op('setBaseAndExtent', idlType.undefined, [
      arg('anchorNode', reference('Node')), arg('anchorOffset', idlType.unsignedLong),
      arg('focusNode', reference('Node')), arg('focusOffset', idlType.unsignedLong),
    ]),
  ],
});

/*
 * dictionary GetComposedRangesOptions {
 *   sequence<ShadowRoot> shadowRoots = [];
 * };
 */
export const getComposedRangesOptionsIDL = defineDictionary({
  name: 'GetComposedRangesOptions',
  members: [dictMember('shadowRoots', sequence(reference('ShadowRoot')), { default: emptySequence })],
});
