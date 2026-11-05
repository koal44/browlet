import { describe, expect, it, vi } from 'vitest';

import type { AbstractRange, Document, Element, Node, Range, Window } from '../../../../src/browlet/platform';
import { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/index';
import type { RangeImpl } from '../../../../src/browlet/dom/ranges/index';
import type { SelectionDirection } from '../../../../src/browlet/interaction/selection/index';
import { createManualUserAgent } from '../../../support/browlet-agent';
import { project, unwrap } from '../../../support/browlet-binding';

describe('Selection API §§6–6.1: user selection and selectstart', () => {
  it.each(['empty', 'caret'])('fires before replacing the %s selection, then queues its change', (previous) => {
    const f = createFixture();
    if (previous === 'caret') f.selection.collapse(f.text, 0);
    f.loop.runTaskTurn();
    const oldRange = f.selection.rangeCount ? f.selection.getRangeAt(0) : null;
    const proposal = proposedRange(f);
    const trace: unknown[] = [];
    f.document.onselectstart = function(event) {
      trace.push(['start', this === f.document, event.target === f.text, event.isTrusted,
        event.bubbles, event.cancelable, event.composed,
        f.selection.rangeCount ? f.selection.getRangeAt(0) === oldRange : oldRange === null]);
    };
    f.document.onselectionchange = () => { trace.push(['change', ...points(f.selection.getRangeAt(0))]); };
    expect(userSelect(f, proposal)).toBe(true);
    expect(trace).toEqual([['start', true, true, true, true, true, false, true]]);
    expect(f.selection.getRangeAt(0)).not.toBe(proposal);
    expect(f.selection.getRangeAt(0)).not.toBe(oldRange);
    expect(points(f.selection.getRangeAt(0))).toEqual([f.text, 1, f.text, 3]);
    expect(f.loop.runTaskTurn()).toBe(true);
    expect(trace[1]).toEqual(['change', f.text, 1, f.text, 3]);
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it('does not fire selectstart while replacing an already noncollapsed ordinary Range', () => {
    const f = createFixture();
    const oldRange = proposedRange(f);
    f.selection.addRange(oldRange);
    f.loop.runTaskTurn();
    const start = vi.fn();
    f.document.onselectstart = start;
    const proposal = proposedRange(f, f.text, 0, f.text, 2);
    expect(userSelect(f, proposal, 'backward')).toBe(true);
    expect(start).not.toHaveBeenCalled();
    expect(f.selection.direction).toBe('backward');
    expect([f.selection.anchorOffset, f.selection.focusOffset]).toEqual([2, 0]);
    expect(points(oldRange)).toEqual([f.text, 1, f.text, 3]);
  });

  it.each(['none', 'forward', 'backward'] as const)('accepts a caret with the producer direction %s without emptying Selection', (direction) => {
    const f = createFixture();
    const start = vi.fn();
    f.document.onselectstart = start;
    expect(userSelect(f, proposedRange(f, f.text, 2, f.text, 2), direction)).toBe(true);
    expect(start).toHaveBeenCalledOnce();
    expect(f.selection.rangeCount).toBe(1);
    expect(f.selection.isCollapsed).toBe(true);
    expect(f.selection.direction).toBe(direction);
  });

  it.each(['empty', 'caret'])('cancellation retains the %s selection and schedules no replacement notification', (previous) => {
    const f = createFixture();
    if (previous === 'caret') f.selection.collapse(f.text, 0);
    f.loop.runTaskTurn();
    const oldRange = f.selection.rangeCount ? f.selection.getRangeAt(0) : null;
    const proposal = proposedRange(f);
    f.document.onselectstart = (event) => { event.preventDefault(); };
    expect(userSelect(f, proposal)).toBe(false);
    expect(f.selection.rangeCount ? f.selection.getRangeAt(0) : null).toBe(oldRange);
    expect(points(proposal)).toEqual([f.text, 1, f.text, 3]);
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it('honors return-false cancellation without rolling back selection changes made by the listener', () => {
    const f = createFixture();
    const proposal = proposedRange(f);
    const authorRange = proposedRange(f, f.otherText, 0, f.otherText, 2);
    f.document.onselectstart = () => {
      f.selection.addRange(authorRange);
      return false;
    };
    expect(userSelect(f, proposal)).toBe(false);
    expect(f.selection.getRangeAt(0)).toBe(authorRange);
    expect(f.loop.runTaskTurn()).toBe(true);
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it('installs the user proposal after an uncanceled listener change without modifying either old Range', () => {
    const f = createFixture();
    const authorRange = proposedRange(f, f.otherText, 0, f.otherText, 2);
    f.document.onselectstart = () => { f.selection.addRange(authorRange); };
    const proposal = proposedRange(f);
    expect(userSelect(f, proposal)).toBe(true);
    const selected = f.selection.getRangeAt(0);
    expect(selected).not.toBe(authorRange);
    expect(selected).not.toBe(proposal);
    expect(points(selected)).toEqual(points(proposal));
    expect(points(authorRange)).toEqual([f.otherText, 0, f.otherText, 2]);
    f.loop.runTaskTurn();
    authorRange.setEnd(f.otherText, 3);
    proposal.setEnd(f.text, 4);
    expect(f.loop.runTaskTurn()).toBe(false);
    selected.setEnd(f.text, 2);
    expect(f.loop.runTaskTurn()).toBe(true);
  });

  it('copies proposal identity and offsets before author callbacks can explicitly edit that proposal', () => {
    const f = createFixture();
    const proposal = proposedRange(f);
    f.document.onselectstart = () => { proposal.selectNodeContents(f.b); };
    expect(userSelect(f, proposal)).toBe(true);
    expect(points(f.selection.getRangeAt(0))).toEqual([f.text, 1, f.text, 3]);
    expect(points(proposal)).toEqual([f.b, 0, f.b, 1]);
  });

  it('tracks text insertion in the private live proposal before association', () => {
    const f = createFixture();
    const proposal = proposedRange(f);
    f.document.onselectstart = () => { f.text.insertData(0, 'XX'); };
    expect(userSelect(f, proposal)).toBe(true);
    expect(points(f.selection.getRangeAt(0))).toEqual([f.text, 3, f.text, 5]);
    expect(points(proposal)).toEqual([f.text, 3, f.text, 5]);
  });

  it('tracks splitText into a new endpoint node during dispatch', () => {
    const f = createFixture();
    const proposal = proposedRange(f);
    f.document.onselectstart = () => { f.text.splitText(2); };
    expect(userSelect(f, proposal)).toBe(true);
    expect(points(f.selection.getRangeAt(0))).toEqual([f.text, 1, f.text.nextSibling, 1]);
  });

  it.each(['start', 'end'])('rejects a disconnected original %s endpoint even after live Range repair', (endpoint) => {
    const f = createFixture();
    const proposal = proposedRange(f, f.text, 1, f.otherText, 3);
    f.document.onselectstart = () => { (endpoint === 'start' ? f.a : f.b).remove(); };
    expect(userSelect(f, proposal)).toBe(false);
    expect(f.selection.rangeCount).toBe(0);
    expect(proposal.startContainer.isConnected).toBe(true);
    expect(proposal.endContainer.isConnected).toBe(true);
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it('rejects endpoints adopted into another Document during dispatch', () => {
    const f = createFixture();
    const other = createFixture();
    const proposal = proposedRange(f);
    f.document.onselectstart = () => { other.root.appendChild(f.a); };
    expect(userSelect(f, proposal)).toBe(false);
    expect(f.a.isConnected).toBe(true);
    expect(f.a.ownerDocument).toBe(other.document);
    expect(f.selection.rangeCount).toBe(0);
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it('keeps live removal repair when the original nodes are reinserted before dispatch ends', () => {
    const f = createFixture();
    const proposal = proposedRange(f);
    const originalIndex = Array.from(f.root.childNodes).indexOf(f.a);
    f.document.onselectstart = () => { f.a.remove(); f.root.appendChild(f.a); };
    expect(userSelect(f, proposal)).toBe(true);
    expect(points(f.selection.getRangeAt(0))).toEqual([f.root, originalIndex, f.root, originalIndex]);
    expect(points(f.selection.getRangeAt(0))).toEqual(points(proposal));
  });

  it.each(['detached', 'foreign'])('ignores an initially %s proposal without dispatch or selection changes', (kind) => {
    const f = createFixture();
    const node = kind === 'detached' ? f.document.createTextNode('other') : createFixture().text;
    const proposal = proposedRange(f, node, 0, node, 2);
    const start = vi.fn();
    f.document.onselectstart = start;
    expect(userSelect(f, proposal)).toBe(false);
    expect(start).not.toHaveBeenCalled();
    expect(f.selection.rangeCount).toBe(0);
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it.each(['before', 'during'])('rejects a Document made inactive %s dispatch', (when) => {
    const f = createFixture();
    const proposal = proposedRange(f);
    const context = f.documentImpl.browsingContext;
    const start = vi.fn(() => { f.documentImpl.browsingContext = null; });
    f.document.onselectstart = start;
    if (when === 'before') f.documentImpl.browsingContext = null;
    try {
      expect(userSelect(f, proposal)).toBe(false);
      expect(start).toHaveBeenCalledTimes(when === 'before' ? 0 : 1);
      expect(f.selection.rangeCount).toBe(0);
    } finally {
      f.documentImpl.browsingContext = context;
    }
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it('accepts a connected shadow Range without composing selectstart outside that root', () => {
    const f = createFixture();
    const shadow = f.a.attachShadow({ mode: 'closed' });
    const text = f.document.createTextNode('shadow');
    shadow.appendChild(text);
    const proposal = proposedRange(f, text, 1, text, 4);
    const outside = vi.fn();
    const inside: unknown[] = [];
    f.document.onselectstart = outside;
    shadow.addEventListener('selectstart', (event) => inside.push([
      event.target === text, event.isTrusted, event.bubbles, event.cancelable, event.composed,
    ]));
    expect(userSelect(f, proposal)).toBe(true);
    expect(inside).toEqual([[true, true, true, true, false]]);
    expect(outside).not.toHaveBeenCalled();
    expect(points(f.selection.getRangeAt(0))).toEqual([text, 1, text, 4]);
    expect(f.loop.runTaskTurn()).toBe(true);
  });

  it('rejects a shadow proposal when its host is removed by selectstart', () => {
    const f = createFixture();
    const shadow = f.a.attachShadow({ mode: 'closed' });
    const text = f.document.createTextNode('shadow');
    shadow.appendChild(text);
    const proposal = proposedRange(f, text, 1, text, 4);
    shadow.addEventListener('selectstart', () => { f.a.remove(); });
    expect(userSelect(f, proposal)).toBe(false);
    expect(f.selection.rangeCount).toBe(0);
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it('allocates the new Range in the Selection realm even when the proposal came from another realm', () => {
    const f = createFixture();
    const other = createFixture();
    const proposal = other.document.createRange();
    proposal.setStart(f.text, 1);
    proposal.setEnd(f.text, 3);
    expect(userSelect(f, proposal)).toBe(true);
    expect(proposal).toBeInstanceOf(other.window.Range);
    expect(f.selection.getRangeAt(0)).toBeInstanceOf(f.window.Range);
    expect(f.selection.getRangeAt(0)).not.toBeInstanceOf(other.window.Range);
    expect(Reflect.has(f.selection, 'selectFromUser')).toBe(false);
  });

  it('replaces an unchanged noncollapsed Range without notifying or firing selectstart', () => {
    const f = createFixture();
    const proposal = proposedRange(f);
    f.selection.addRange(proposal);
    f.loop.runTaskTurn();
    const start = vi.fn();
    f.document.onselectstart = start;
    expect(userSelect(f, proposal)).toBe(true);
    expect(f.selection.getRangeAt(0)).not.toBe(proposal);
    expect(points(f.selection.getRangeAt(0))).toEqual(points(proposal));
    expect(start).not.toHaveBeenCalled();
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it('still runs the gate for an unchanged caret while omitting an unchanged notification', () => {
    const f = createFixture();
    f.selection.collapse(f.text, 1);
    const oldRange = f.selection.getRangeAt(0);
    f.loop.runTaskTurn();
    const start = vi.fn();
    f.document.onselectstart = start;
    expect(userSelect(f, oldRange, 'none')).toBe(true);
    expect(start).toHaveBeenCalledOnce();
    expect(f.selection.getRangeAt(0)).not.toBe(oldRange);
    expect(points(f.selection.getRangeAt(0))).toEqual(points(oldRange));
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it('retains an unrelated existing caret when a listener invalidates the proposed selection', () => {
    const f = createFixture();
    f.selection.collapse(f.otherText, 1);
    const oldRange = f.selection.getRangeAt(0);
    f.loop.runTaskTurn();
    f.document.onselectstart = () => { f.a.remove(); };
    expect(userSelect(f, proposedRange(f))).toBe(false);
    expect(f.selection.getRangeAt(0)).toBe(oldRange);
    expect(points(oldRange)).toEqual([f.otherText, 1, f.otherText, 1]);
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it('replaces and detaches an existing composed span using the associated ordinary Range gate', () => {
    const f = createFixture();
    const shadow = f.a.attachShadow({ mode: 'closed' });
    const text = f.document.createTextNode('shadow');
    shadow.appendChild(text);
    f.selection.setBaseAndExtent(f.text, 1, text, 4);
    f.loop.runTaskTurn();
    const start = vi.fn();
    f.document.onselectstart = start;
    expect(userSelect(f, proposedRange(f))).toBe(true);
    expect(start).toHaveBeenCalledOnce();
    expect(points(f.selection.getComposedRanges({ shadowRoots: [shadow] })[0]!))
      .toEqual([f.text, 1, f.text, 3]);
    f.loop.runTaskTurn();
    text.appendData('more');
    expect(f.loop.runTaskTurn()).toBe(false);
  });
});

/** Real DOM, binding, and task delivery; only the unfinished gesture producer is supplied. */
function createFixture() {
  const traversable = TopLevelTraversable.create(createManualUserAgent(), null, '');
  const documentImpl = traversable.activeDocument!;
  const document = project(documentImpl) as Document;
  const root: Element = document.documentElement ?? document.createElement('html');
  if (!root.isConnected) document.appendChild(root);
  const a = document.createElement('div');
  const b = document.createElement('div');
  const text = document.createTextNode('abcd');
  const otherText = document.createTextNode('other');
  a.appendChild(text);
  b.appendChild(otherText);
  root.append(a, b);
  const window = project(traversable.activeWindow!) as Window;
  const selection = document.getSelection()!;
  return {
    documentImpl, document, root, a, b, text, otherText, window, selection,
    selectionImpl: documentImpl.getSelection()!, loop: documentImpl.env.responsibleEventLoop,
  };
}

function proposedRange(
  f: ReturnType<typeof createFixture>, start: Node = f.text, startOffset = 1,
  end: Node = start, endOffset = 3,
): Range {
  const range = f.document.createRange();
  range.setStart(start, startOffset);
  range.setEnd(end, endOffset);
  return range;
}

function userSelect(f: ReturnType<typeof createFixture>, range: Range, direction: SelectionDirection = 'forward'): boolean {
  return f.selectionImpl.selectFromUser(unwrap<RangeImpl>(range), direction);
}

function points(range: AbstractRange): unknown[] {
  return [range.startContainer, range.startOffset, range.endContainer, range.endOffset];
}
