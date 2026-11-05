import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AbstractRange, Document, Element, Node, Range, Selection, ShadowRoot, Window } from '../../../../src/browlet/platform';
import { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/index';
import { userInteractionTaskSource } from '../../../../src/browlet/scripting/index';
import { createManualUserAgent } from '../../../support/browlet-agent';
import { project } from '../../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('Selection API §§2–3, 4.1–4.2: Document selection and range identity', () => {
  it('shares one initially empty Selection between Document and Window without a public constructor', () => {
    const f = createFixture();
    expect(f.window.getSelection()).toBe(f.selection);
    expect(f.document.getSelection()).toBe(f.selection);
    expect(f.selection).toBeInstanceOf(f.window.Selection);
    expect(Object.prototype.toString.call(f.selection)).toBe('[object Selection]');
    expect(() => Reflect.construct(f.window.Selection as unknown as new () => Selection, [])).toThrow();
    expect(state(f.selection)).toEqual([null, 0, null, 0, true, 0, 'None', 'none']);
    expect(() => f.selection.getRangeAt(0)).toThrow(expect.objectContaining({ name: 'IndexSizeError' }));
  });

  it('returns null for a Document without a browsing context', () => {
    const f = createFixture();
    expect(f.document.implementation.createHTMLDocument('').getSelection()).toBeNull();
  });

  it('retains the exact Range and ignores further added ranges', () => {
    const f = createFixture();
    const range = selectedRange(f);
    const other = f.document.createRange();
    other.selectNodeContents(f.b);
    f.selection.addRange(other);
    expect(f.selection.getRangeAt(0)).toBe(range);
    expect(state(f.selection)).toEqual([f.text, 1, f.text, 3, false, 1, 'Range', 'forward']);
    expect(() => f.selection.getRangeAt(1)).toThrow(expect.objectContaining({ name: 'IndexSizeError' }));
    expect(() => f.selection.getRangeAt(-1)).toThrow(expect.objectContaining({ name: 'IndexSizeError' }));
    expect(f.selection.getRangeAt(2 ** 32)).toBe(range);
  });

  it('rejects author values at the IDL boundary and ignores ranges rooted outside the Document', () => {
    const f = createFixture();
    expect(() => f.selection.addRange({} as Range)).toThrow();
    expect(() => f.selection.getRangeAt.call({} as Selection, 0)).toThrow();
    const range = f.document.createRange();
    range.selectNodeContents(f.document.createDocumentFragment());
    f.selection.addRange(range);
    const host = f.document.createElement('div');
    f.root.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.textContent = 'shadow';
    range.selectNodeContents(shadow);
    f.selection.addRange(range);
    expect(f.selection.rangeCount).toBe(0);
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it('requires identity for removeRange, and empty detaches the live notification connection', () => {
    const f = createFixture();
    const range = selectedRange(f);
    expect(() => f.selection.removeRange(range.cloneRange())).toThrow(expect.objectContaining({ name: 'NotFoundError' }));
    f.selection.removeRange(range);
    expect(state(f.selection)).toEqual([null, 0, null, 0, true, 0, 'None', 'none']);
    expect(() => f.selection.removeRange(range)).toThrow(expect.objectContaining({ name: 'NotFoundError' }));
    f.selection.addRange(range);
    f.selection.empty();
    f.loop.runTaskTurn();
    range.setEnd(f.text, 2);
    f.selection.empty();
    f.selection.removeAllRanges();
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it('preserves forward direction through collapsing and expanding an attached Range', () => {
    const f = createFixture();
    const range = f.document.createRange();
    range.setStart(f.text, 1);
    f.selection.addRange(range);
    expect(state(f.selection)).toEqual([f.text, 1, f.text, 1, true, 1, 'Caret', 'forward']);
    range.setEnd(f.text, 3);
    expect(f.selection.direction).toBe('forward');
    range.collapse(false);
    expect(state(f.selection)).toEqual([f.text, 3, f.text, 3, true, 1, 'Caret', 'forward']);
  });

  it('preserves receiver and Range realms across borrowed accessors and methods', () => {
    const first = createFixture();
    const second = createFixture(first.userAgent);
    const borrowed = first.document.getSelection.call(second.document)!;
    expect(borrowed).toBe(second.selection);
    expect(borrowed).toBeInstanceOf(second.window.Selection);
    expect(borrowed).not.toBeInstanceOf(first.window.Selection);
    const range = first.document.createRange();
    range.selectNodeContents(second.text);
    first.selection.addRange.call(borrowed, range);
    expect(first.selection.getRangeAt.call(borrowed, 0)).toBe(range);
    expect(range).toBeInstanceOf(first.window.Range);
    expect(first.selection.rangeCount).toBe(0);
    expect(second.selection.anchorNode).toBe(second.text);
  });
});

describe('Selection API §3: composed-range snapshots', () => {
  it('returns fresh empty arrays and validates dictionary members before reading the selection', () => {
    const f = createFixture();
    const empty = f.selection.getComposedRanges();
    expect(empty).toEqual([]);
    expect(f.selection.getComposedRanges({})).toEqual([]);
    expect(f.selection.getComposedRanges()).not.toBe(empty);
    expect(() => f.selection.getComposedRanges({ shadowRoots: [f.root as unknown as ShadowRoot] }))
      .toThrow(expect.objectContaining({ name: 'TypeError' }));
    expect(() => f.selection.getComposedRanges({ shadowRoots: null as unknown as ShadowRoot[] }))
      .toThrow(expect.objectContaining({ name: 'TypeError' }));
    expect(() => f.selection.getComposedRanges.call({} as Selection)).toThrow();
  });

  it('returns a fresh StaticRange without tracking later live-range or text mutations', () => {
    const f = createFixture();
    const range = selectedRange(f);
    f.loop.runTaskTurn();
    const first = f.selection.getComposedRanges();
    const second = f.selection.getComposedRanges();
    const snapshot = first[0]!;
    expect(first).not.toBe(second);
    expect(snapshot).not.toBe(second[0]);
    expect(snapshot).toBeInstanceOf(f.window.StaticRange);
    expect(snapshot).not.toBeInstanceOf(f.window.Range);
    expect(boundaries(snapshot)).toEqual([f.text, 1, f.text, 3]);
    expect(snapshot.collapsed).toBe(false);
    expect(f.selection.getRangeAt(0)).toBe(range);
    expect(f.loop.runTaskTurn()).toBe(false);
    range.setStart(f.text, 2);
    f.text.insertData(0, 'XX');
    expect(boundaries(snapshot)).toEqual([f.text, 1, f.text, 3]);
    expect(boundaries(f.selection.getComposedRanges()[0]!)).toEqual([f.text, 4, f.text, 5]);
  });

  it('rescopes nested closed roots to the permitted host and accepts a deeper root for an outer endpoint', () => {
    const f = createFixture();
    const host = f.document.createElement('div');
    const hostIndex = f.root.childNodes.length;
    f.root.appendChild(host);
    const outer = host.attachShadow({ mode: 'closed' });
    const prefix = f.document.createTextNode('outer');
    const innerHost = f.document.createElement('section');
    outer.append(prefix, innerHost);
    const inner = innerHost.attachShadow({ mode: 'closed' });
    const deep = f.document.createTextNode('deep');
    inner.appendChild(deep);
    f.selection.collapse(deep, 1);
    f.selection.getRangeAt(0).setEnd(deep, 3);
    expect(boundaries(f.selection.getComposedRanges()[0]!)).toEqual([f.root, hostIndex, f.root, hostIndex + 1]);
    expect(boundaries(f.selection.getComposedRanges({ shadowRoots: [outer] })[0]!))
      .toEqual([outer, 1, outer, 2]);
    const snapshot = f.selection.getComposedRanges({ shadowRoots: new Set([inner]) })[0]!;
    expect(boundaries(snapshot)).toEqual([deep, 1, deep, 3]);
    expect(boundaries(f.selection.getComposedRanges({ shadowRoots: [outer, inner] })[0]!))
      .toEqual([deep, 1, deep, 3]);
    const unrelated = f.document.createElement('div').attachShadow({ mode: 'open' });
    expect(boundaries(f.selection.getComposedRanges({ shadowRoots: [unrelated] })[0]!))
      .toEqual([f.root, hostIndex, f.root, hostIndex + 1]);
    f.selection.collapse(prefix, 2);
    expect(boundaries(f.selection.getComposedRanges({ shadowRoots: [inner] })[0]!))
      .toEqual([prefix, 2, prefix, 2]);
    f.selection.collapse(deep, 2);
    host.remove();
    expect(f.selection.getComposedRanges()).toEqual([]);
    expect(boundaries(snapshot)).toEqual([deep, 1, deep, 3]);
  });

  it('reads the current selection after dictionary conversion runs author code', () => {
    const f = createFixture();
    selectedRange(f);
    const result = f.selection.getComposedRanges({
      get shadowRoots() {
        f.selection.collapse(f.b.firstChild, 2);
        return [];
      },
    });
    expect(boundaries(result[0]!)).toEqual([f.b.firstChild, 2, f.b.firstChild, 2]);
    expect(f.selection.getComposedRanges({
      get shadowRoots() {
        f.selection.removeAllRanges();
        return [];
      },
    })).toEqual([]);
  });

  it('allocates borrowed snapshots and their array in the receiver realm, independent of the live Range realm', () => {
    const first = createFixture();
    const second = createFixture(first.userAgent);
    const range = first.document.createRange();
    range.setStart(second.text, 1);
    range.setEnd(second.text, 3);
    second.selection.addRange(range);
    const result = first.selection.getComposedRanges.call(second.selection);
    expect(result).toBeInstanceOf(second.documentImpl.env.realm.Array);
    expect(result).not.toBeInstanceOf(first.documentImpl.env.realm.Array);
    expect(result[0]).toBeInstanceOf(second.window.StaticRange);
    expect(result[0]).not.toBeInstanceOf(first.window.StaticRange);
    expect(boundaries(result[0]!)).toEqual([second.text, 1, second.text, 3]);
    expect(second.selection.getRangeAt(0)).toBe(range);
    expect(range).toBeInstanceOf(first.window.Range);
  });
});

describe('Selection API §3: collapse and Range replacement', () => {
  it.each([
    ['collapse', 2], ['setPosition', 2], ['collapseToStart', 1], ['collapseToEnd', 3],
  ] as const)('%s replaces and detaches the old Range without mutating it', (method, offset) => {
    const f = createFixture();
    const oldRange = selectedRange(f);
    f.loop.runTaskTurn();
    const collapse = () => {
      if (method === 'collapse' || method === 'setPosition') f.selection[method](f.text, offset);
      else f.selection[method]();
    };
    collapse();
    const range = f.selection.getRangeAt(0);
    expect(range).not.toBe(oldRange);
    expect(boundaries(oldRange)).toEqual([f.text, 1, f.text, 3]);
    expect(state(f.selection)).toEqual([f.text, offset, f.text, offset, true, 1, 'Caret', 'none']);
    expect(f.loop.runTaskTurn()).toBe(true);
    oldRange.setStart(f.b.firstChild!, 0);
    expect(f.loop.runTaskTurn()).toBe(false);
    collapse();
    expect(f.selection.getRangeAt(0)).not.toBe(range);
    expect(f.loop.runTaskTurn()).toBe(false);
    range.setEnd(f.text, 4);
    expect(f.loop.runTaskTurn()).toBe(false);
    f.selection.getRangeAt(0).setEnd(f.text, 4);
    expect(f.selection.direction).toBe('none');
    expect(f.loop.runTaskTurn()).toBe(true);
  });

  it.each(['collapseToStart', 'collapseToEnd'] as const)('%s rejects an empty Selection', (method) => {
    const f = createFixture();
    expect(() => f.selection[method]()).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it.each(['collapse', 'setPosition'] as const)('%s uses IDL defaults/conversion and null clears the Selection', (method) => {
    const f = createFixture();
    f.selection[method](f.text);
    expect(boundaries(f.selection.getRangeAt(0))).toEqual([f.text, 0, f.text, 0]);
    f.selection[method](f.text, 2 ** 32 + 1);
    expect(boundaries(f.selection.getRangeAt(0))).toEqual([f.text, 1, f.text, 1]);
    f.selection[method](null, 100);
    expect(f.selection.rangeCount).toBe(0);
    f.loop.runTaskTurn();
    f.selection[method](undefined as unknown as Node | null);
    expect(f.loop.runTaskTurn()).toBe(false);
    expect(() => { Reflect.apply(f.selection[method], f.selection, []); }).toThrow();
    expect(() => f.selection[method]({} as Node)).toThrow();
    expect(() => f.selection[method].call({} as Selection, f.text)).toThrow();
  });

  it('validates node kind and offset before ignoring detached or foreign nodes', () => {
    const f = createFixture();
    const range = selectedRange(f);
    f.loop.runTaskTurn();
    const detached = f.document.createTextNode('x');
    const other = createFixture(f.userAgent);
    const doctype = other.document.implementation.createDocumentType('html', '', '');
    expect(() => f.selection.collapse(doctype, 100)).toThrow(expect.objectContaining({ name: 'InvalidNodeTypeError' }));
    for (const node of [f.text, detached, other.text]) {
      expect(() => f.selection.collapse(node, 100)).toThrow(expect.objectContaining({ name: 'IndexSizeError' }));
    }
    expect(() => f.selection.collapse(f.text, -1)).toThrow(expect.objectContaining({ name: 'IndexSizeError' }));
    f.selection.collapse(detached, 1);
    f.selection.collapse(other.text, 1);
    expect(f.selection.getRangeAt(0)).toBe(range);
    expect(boundaries(range)).toEqual([f.text, 1, f.text, 3]);
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it('notifies a direction change even when a replacement has the same endpoints', () => {
    const f = createFixture();
    const range = f.document.createRange();
    range.setStart(f.text, 1);
    f.selection.addRange(range);
    f.loop.runTaskTurn();
    expect(f.selection.direction).toBe('forward');
    f.selection.collapse(f.text, 1);
    expect(f.selection.direction).toBe('none');
    expect(f.loop.runTaskTurn()).toBe(true);
    f.selection.setPosition(f.text, 1);
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it('allocates a new Range in the Selection receiver realm when collapse is borrowed', () => {
    const first = createFixture();
    const second = createFixture(first.userAgent);
    first.selection.collapse.call(second.selection, second.text, 2);
    const range = second.selection.getRangeAt(0);
    expect(range).toBeInstanceOf(second.window.Range);
    expect(range).not.toBeInstanceOf(first.window.Range);
    expect(boundaries(range)).toEqual([second.text, 2, second.text, 2]);
    expect(first.selection.rangeCount).toBe(0);
  });
});

describe('Selection API §3: anchor, focus, and direction', () => {
  it('extends from a fixed anchor through backward, equal, and forward positions', () => {
    const f = createFixture();
    f.selection.setBaseAndExtent(f.text, 3, f.text, 1);
    const old = f.selection.getRangeAt(0);
    f.selection.extend(f.text, 0);
    expect(state(f.selection)).toEqual([f.text, 3, f.text, 0, false, 1, 'Range', 'backward']);
    expect(boundaries(f.selection.getRangeAt(0))).toEqual([f.text, 0, f.text, 3]);
    expect(boundaries(old)).toEqual([f.text, 1, f.text, 3]);
    f.selection.extend(f.text, 3);
    expect(state(f.selection)).toEqual([f.text, 3, f.text, 3, true, 1, 'Caret', 'forward']);
    f.selection.extend(f.b.firstChild!);
    expect(state(f.selection)).toEqual([f.text, 3, f.b.firstChild, 0, false, 1, 'Range', 'forward']);
  });

  it('orders explicit endpoints while retaining the supplied backward anchor and focus', () => {
    const f = createFixture();
    f.selection.setBaseAndExtent(f.b.firstChild!, 2, f.text, 1);
    expect(state(f.selection)).toEqual([f.b.firstChild, 2, f.text, 1, false, 1, 'Range', 'backward']);
    expect(boundaries(f.selection.getRangeAt(0))).toEqual([f.text, 1, f.b.firstChild, 2]);
    expect(boundaries(f.selection.getComposedRanges()[0]!)).toEqual([f.text, 1, f.b.firstChild, 2]);
    f.selection.setBaseAndExtent(f.a, 0, f.text, 2);
    expect(state(f.selection)).toEqual([f.a, 0, f.text, 2, false, 1, 'Range', 'forward']);
    f.selection.setBaseAndExtent(f.a, 1, f.text, 2);
    expect(state(f.selection)).toEqual([f.a, 1, f.text, 2, false, 1, 'Range', 'backward']);
    expect(boundaries(f.selection.getRangeAt(0))).toEqual([f.text, 2, f.a, 1]);
  });

  it.each(['extend', 'setBaseAndExtent'] as const)('%s replaces and detaches even an unchanged Range', (method) => {
    const f = createFixture();
    const old = selectedRange(f);
    f.loop.runTaskTurn();
    if (method === 'extend') f.selection.extend(f.text, 3);
    else f.selection.setBaseAndExtent(f.text, 1, f.text, 3);
    const current = f.selection.getRangeAt(0);
    expect(current).not.toBe(old);
    expect(boundaries(old)).toEqual([f.text, 1, f.text, 3]);
    expect(f.loop.runTaskTurn()).toBe(false);
    old.setStart(f.b.firstChild!, 0);
    expect(f.loop.runTaskTurn()).toBe(false);
    current.setEnd(f.text, 4);
    expect(f.selection.focusOffset).toBe(4);
    expect(f.loop.runTaskTurn()).toBe(true);
  });

  it.each(['extend', 'setBaseAndExtent'] as const)('%s establishes forward direction for equal points', (method) => {
    const f = createFixture();
    f.selection.collapse(f.text, 2);
    f.loop.runTaskTurn();
    if (method === 'extend') f.selection.extend(f.text, 2);
    else f.selection.setBaseAndExtent(f.text, 2, f.text, 2);
    expect(state(f.selection)).toEqual([f.text, 2, f.text, 2, true, 1, 'Caret', 'forward']);
    expect(f.loop.runTaskTurn()).toBe(true);
  });

  it('preserves backward direction through live Range mutation and DOM edits', () => {
    const f = createFixture();
    f.selection.setBaseAndExtent(f.text, 3, f.text, 1);
    const range = f.selection.getRangeAt(0);
    range.setStart(f.text, 0);
    f.text.insertData(0, 'XX');
    expect(state(f.selection)).toEqual([f.text, 5, f.text, 0, false, 1, 'Range', 'backward']);
    range.collapse(true);
    expect(state(f.selection)).toEqual([f.text, 0, f.text, 0, true, 1, 'Caret', 'backward']);
    range.setEnd(f.text, 2);
    expect(state(f.selection)).toEqual([f.text, 2, f.text, 0, false, 1, 'Range', 'backward']);
    expect(f.selection.getRangeAt(0)).toBe(range);
  });

  it('checks extend membership before empty state and offsets', () => {
    const f = createFixture();
    const other = createFixture(f.userAgent);
    const detached = f.document.createTextNode('detached');
    f.selection.extend(detached, 100);
    f.selection.extend(other.text, 100);
    expect(f.selection.rangeCount).toBe(0);
    expect(() => f.selection.extend(f.text, 100)).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
    const doctype = f.document.implementation.createDocumentType('html', '', '');
    f.document.insertBefore(doctype, f.root);
    expect(() => f.selection.extend(doctype, 100)).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
    const old = selectedRange(f);
    f.loop.runTaskTurn();
    f.selection.extend(detached, 100);
    f.selection.extend(other.text, 100);
    expect(() => f.selection.extend(doctype, 100)).toThrow(expect.objectContaining({ name: 'InvalidNodeTypeError' }));
    expect(() => f.selection.extend(f.text, 100)).toThrow(expect.objectContaining({ name: 'IndexSizeError' }));
    expect(f.selection.getRangeAt(0)).toBe(old);
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it('validates each explicit point before ignoring detached or foreign nodes', () => {
    const f = createFixture();
    const old = selectedRange(f);
    f.loop.runTaskTurn();
    const other = createFixture(f.userAgent);
    const detached = f.document.createTextNode('detached');
    const doctype = f.document.implementation.createDocumentType('html', '', '');
    expect(() => f.selection.setBaseAndExtent(doctype, 100, f.text, 1))
      .toThrow(expect.objectContaining({ name: 'InvalidNodeTypeError' }));
    expect(() => f.selection.setBaseAndExtent(doctype, 0, f.text, 1))
      .toThrow(expect.objectContaining({ name: 'InvalidNodeTypeError' }));
    expect(() => f.selection.setBaseAndExtent(f.text, 100, doctype, 0))
      .toThrow(expect.objectContaining({ name: 'IndexSizeError' }));
    expect(() => f.selection.setBaseAndExtent(f.text, 1, other.text, 100))
      .toThrow(expect.objectContaining({ name: 'IndexSizeError' }));
    f.selection.setBaseAndExtent(detached, 1, f.text, 1);
    f.selection.setBaseAndExtent(f.text, 1, other.text, 1);
    expect(f.selection.getRangeAt(0)).toBe(old);
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it('requires Node arguments and converts unsigned offsets at the IDL boundary', () => {
    const f = createFixture();
    const old = selectedRange(f);
    expect(() => f.selection.extend(null as unknown as Node)).toThrow(expect.objectContaining({ name: 'TypeError' }));
    expect(() => f.selection.setBaseAndExtent(null as unknown as Node, 0, f.text, 1))
      .toThrow(expect.objectContaining({ name: 'TypeError' }));
    expect(() => f.selection.setBaseAndExtent(f.text, 0, {} as Node, 1))
      .toThrow(expect.objectContaining({ name: 'TypeError' }));
    expect(() => {
      // @ts-expect-error The required focus offset is deliberately omitted.
      f.selection.setBaseAndExtent(f.text, 0, f.text);
    }).toThrow();
    expect(f.selection.getRangeAt(0)).toBe(old);
    f.selection.extend(f.text, 2 ** 32 + 2);
    expect(f.selection.focusOffset).toBe(2);
    f.selection.setBaseAndExtent(f.text, 2 ** 32 + 3, f.text, 2 ** 32 + 1);
    expect(state(f.selection)).toEqual([f.text, 3, f.text, 1, false, 1, 'Range', 'backward']);
  });

  it('reads the current anchor after offset conversion can change the selection', () => {
    const f = createFixture();
    selectedRange(f);
    f.selection.extend(f.text, {
      valueOf() {
        f.selection.setBaseAndExtent(f.b.firstChild!, 1, f.b.firstChild!, 3);
        return 0;
      },
    } as unknown as number);
    expect(state(f.selection)).toEqual([f.b.firstChild, 1, f.text, 0, false, 1, 'Range', 'backward']);
  });

  it('handles backward selections entirely inside a closed shadow root', () => {
    const f = createFixture();
    const host = f.document.createElement('div');
    f.root.appendChild(host);
    const shadow = host.attachShadow({ mode: 'closed' });
    const text = f.document.createTextNode('shadow');
    shadow.appendChild(text);
    f.selection.setBaseAndExtent(text, 5, text, 2);
    expect(state(f.selection)).toEqual([text, 5, text, 2, false, 1, 'Range', 'backward']);
    f.selection.extend(text, 1);
    expect(boundaries(f.selection.getComposedRanges({ shadowRoots: [shadow] })[0]!)).toEqual([text, 1, text, 5]);
    host.remove();
    expect(f.selection.rangeCount).toBe(0);
  });

  it.each(['document-to-shadow', 'shadow-to-document', 'outer-to-inner'] as const)(
    'extend collapses at the new focus for %s', (transition) => {
      const f = createFixture();
      const host = f.document.createElement('div');
      f.root.appendChild(host);
      const shadow = host.attachShadow({ mode: 'closed' });
      const text = f.document.createTextNode('shadow');
      const innerHost = f.document.createElement('div');
      shadow.append(text, innerHost);
      const inner = innerHost.attachShadow({ mode: 'closed' });
      const innerText = f.document.createTextNode('nested');
      inner.appendChild(innerText);
      const anchor = transition === 'document-to-shadow' ? f.text : text;
      const focus = transition === 'shadow-to-document' ? f.text : transition === 'outer-to-inner' ? innerText : text;
      f.selection.setBaseAndExtent(anchor, 1, anchor, 2);
      const old = f.selection.getRangeAt(0);
      f.selection.extend(focus, 3);
      expect(state(f.selection)).toEqual([focus, 3, focus, 3, true, 1, 'Caret', 'none']);
      expect(boundaries(old)).toEqual([anchor, 1, anchor, 2]);
      expect(boundaries(f.selection.getComposedRanges({ shadowRoots: [shadow, inner] })[0]!))
        .toEqual([focus, 3, focus, 3]);
    },
  );

  it('retains the composed span when setBaseAndExtent crosses a shadow root', () => {
    const f = createFixture();
    const host = f.document.createElement('div');
    f.root.appendChild(host);
    const shadow = host.attachShadow({ mode: 'closed' });
    const text = f.document.createTextNode('shadow');
    shadow.appendChild(text);
    f.selection.setBaseAndExtent(f.text, 1, text, 3);
    expect(boundaries(f.selection.getComposedRanges({ shadowRoots: [shadow] })[0]!))
      .toEqual([f.text, 1, text, 3]);
  });

  it.each(['extend', 'setBaseAndExtent'] as const)('%s keeps borrowed results in the receiver realm', (method) => {
    const first = createFixture();
    const second = createFixture(first.userAgent);
    selectedRange(second);
    if (method === 'extend') first.selection.extend.call(second.selection, second.text, 0);
    else first.selection.setBaseAndExtent.call(second.selection, second.text, 3, second.text, 1);
    expect(second.selection.getRangeAt(0)).toBeInstanceOf(second.window.Range);
    expect(second.selection.getRangeAt(0)).not.toBeInstanceOf(first.window.Range);
    expect(second.selection.direction).toBe('backward');
    expect(first.selection.rangeCount).toBe(0);
    expect(() => first.selection.extend.call(second.selection, second.text, 100)).toThrow(first.window.DOMException);
  });

  it('notifies a direction reversal with unchanged range boundaries, coalescing later changes', () => {
    const f = createFixture();
    selectedRange(f);
    f.loop.runTaskTurn();
    const observed: string[] = [];
    f.document.addEventListener('selectionchange', () => observed.push(f.selection.direction));
    f.selection.setBaseAndExtent(f.text, 3, f.text, 1);
    expect(boundaries(f.selection.getRangeAt(0))).toEqual([f.text, 1, f.text, 3]);
    expect(observed).toEqual([]);
    expect(f.loop.runTaskTurn()).toBe(true);
    expect(observed).toEqual(['backward']);
    f.selection.setBaseAndExtent(f.text, 3, f.text, 1);
    expect(f.loop.runTaskTurn()).toBe(false);
    f.selection.extend(f.text, 0);
    f.selection.extend(f.text, 4);
    expect(f.loop.runTaskTurn()).toBe(true);
    expect(observed).toEqual(['backward', 'forward']);
    expect(f.loop.runTaskTurn()).toBe(false);
  });
});

describe('Selection API §3: live composed spans across roots', () => {
  it.each([false, true])('retains a full composed span with backward=%s and an ordinary collapsed Range', (backward) => {
    const f = createCrossRootFixture();
    if (backward) f.selection.setBaseAndExtent(f.shadowText, 4, f.text, 1);
    const range = f.selection.getRangeAt(0);
    expect(state(f.selection)).toEqual([f.shadowText, 4, f.shadowText, 4, true, 1, 'Caret', backward ? 'backward' : 'forward']);
    expect(boundaries(range)).toEqual([f.shadowText, 4, f.shadowText, 4]);
    expect(boundaries(f.selection.getComposedRanges({ shadowRoots: [f.shadow] })[0]!))
      .toEqual([f.text, 1, f.shadowText, 4]);
    const index = Array.from(f.root.childNodes).indexOf(f.host);
    expect(boundaries(f.selection.getComposedRanges()[0]!)).toEqual([f.text, 1, f.root, index + 1]);
    expect(f.selection.getRangeAt(0)).toBe(range);
  });

  it('orders parent offsets and the host zero boundary around its shadow tree', () => {
    const f = createCrossRootFixture();
    const index = Array.from(f.root.childNodes).indexOf(f.host);
    for (const [node, offset, backward] of [[f.root, index, false], [f.root, index + 1, true], [f.host, 0, false]] as const) {
      f.selection.setBaseAndExtent(node, offset, f.shadowText, 2);
      expect(f.selection.direction).toBe(backward ? 'backward' : 'forward');
      expect(boundaries(f.selection.getComposedRanges({ shadowRoots: [f.shadow] })[0]!))
        .toEqual(backward ? [f.shadowText, 2, node, offset] : [node, offset, f.shadowText, 2]);
    }
    const light = f.document.createTextNode('light');
    f.host.appendChild(light);
    f.selection.setBaseAndExtent(f.host, 1, f.shadowText, 2);
    expect(f.selection.direction).toBe('backward');
    expect(boundaries(f.selection.getComposedRanges({ shadowRoots: [f.shadow] })[0]!))
      .toEqual([f.shadowText, 2, f.host, 1]);
  });

  it.each([false, true])('orders sibling and nested roots with backward=%s', (backward) => {
    const f = createCrossRootFixture();
    const nestedHost = f.document.createElement('div');
    f.shadow.appendChild(nestedHost);
    const nested = nestedHost.attachShadow({ mode: 'closed' });
    const nestedText = f.document.createTextNode('nested');
    nested.appendChild(nestedText);
    const siblingHost = f.document.createElement('div');
    f.root.appendChild(siblingHost);
    const sibling = siblingHost.attachShadow({ mode: 'closed' });
    const siblingText = f.document.createTextNode('sibling');
    sibling.appendChild(siblingText);
    for (const [start, end] of [[f.shadowText, nestedText], [nestedText, siblingText]]) {
      if (backward) f.selection.setBaseAndExtent(end!, 3, start!, 1);
      else f.selection.setBaseAndExtent(start!, 1, end!, 3);
      expect(f.selection.direction).toBe(backward ? 'backward' : 'forward');
      expect(boundaries(f.selection.getRangeAt(0))).toEqual([end, 3, end, 3]);
      expect(boundaries(f.selection.getComposedRanges({ shadowRoots: [nested, sibling] })[0]!))
        .toEqual([start, 1, end, 3]);
    }
  });

  it.each([false, true])('uses shadow-host ordering independently of slot position (slot first=%s)', (slotFirst) => {
    const f = createCrossRootFixture();
    const light = f.document.createElement('span');
    light.slot = 'content'; light.textContent = 'light';
    f.host.appendChild(light);
    const slot = f.document.createElement('slot'); slot.setAttribute('name', 'content');
    if (slotFirst) f.shadow.insertBefore(slot, f.span);
    else f.shadow.appendChild(slot);
    f.selection.setBaseAndExtent(light.firstChild!, 1, f.shadowText, 4);
    expect(f.selection.direction).toBe('backward');
    expect(boundaries(f.selection.getComposedRanges({ shadowRoots: [f.shadow] })[0]!))
      .toEqual([f.shadowText, 4, light.firstChild, 1]);
  });

  it('keeps snapshots static while live text edits update both composed endpoints', () => {
    const f = createCrossRootFixture();
    const snapshot = f.selection.getComposedRanges({ shadowRoots: [f.shadow] })[0]!;
    const range = f.selection.getRangeAt(0);
    f.loop.runTaskTurn();
    f.text.insertData(0, '++'); f.shadowText.insertData(0, '++');
    expect(boundaries(snapshot)).toEqual([f.text, 1, f.shadowText, 4]);
    expect(boundaries(f.selection.getComposedRanges({ shadowRoots: [f.shadow] })[0]!))
      .toEqual([f.text, 3, f.shadowText, 6]);
    expect(boundaries(range)).toEqual([f.shadowText, 6, f.shadowText, 6]);
    expect(f.selection.getRangeAt(0)).toBe(range);
    expect(f.loop.runTaskTurn()).toBe(true);
    expect(f.loop.runTaskTurn()).toBe(false);
    f.text.replaceData(0, 4, 'x'); f.shadowText.deleteData(0, 7);
    expect(boundaries(f.selection.getComposedRanges({ shadowRoots: [f.shadow] })[0]!))
      .toEqual([f.text, 0, f.shadowText, 0]);
  });

  it('follows split and normalized Text nodes at either composed endpoint', () => {
    const f = createCrossRootFixture();
    const start = f.text.splitText(0);
    const end = f.shadowText.splitText(2);
    expect(boundaries(f.selection.getComposedRanges({ shadowRoots: [f.shadow] })[0]!))
      .toEqual([start, 1, end, 2]);
    f.a.normalize(); f.span.normalize();
    expect(boundaries(f.selection.getComposedRanges({ shadowRoots: [f.shadow] })[0]!))
      .toEqual([start, 1, f.shadowText, 4]);
    expect(boundaries(f.selection.getRangeAt(0))).toEqual([f.shadowText, 4, f.shadowText, 4]);
  });

  it('repairs removed endpoint subtrees inside each ordinary root', () => {
    const f = createCrossRootFixture();
    f.text.remove(); f.span.remove();
    expect(boundaries(f.selection.getComposedRanges({ shadowRoots: [f.shadow] })[0]!))
      .toEqual([f.a, 0, f.shadow, 0]);
    expect(boundaries(f.selection.getRangeAt(0))).toEqual([f.shadow, 0, f.shadow, 0]);
    f.a.appendChild(f.text); f.shadow.appendChild(f.span);
    expect(boundaries(f.selection.getComposedRanges({ shadowRoots: [f.shadow] })[0]!))
      .toEqual([f.a, 0, f.shadow, 0]);
  });

  it('adjusts child offsets before and after insertion and removal in both roots', () => {
    const f = createCrossRootFixture();
    f.selection.setBaseAndExtent(f.a, 1, f.shadow, 1);
    const first = f.document.createElement('i'); const last = f.document.createElement('i');
    f.a.insertBefore(first, f.text); f.shadow.insertBefore(last, f.span);
    expect(boundaries(f.selection.getComposedRanges({ shadowRoots: [f.shadow] })[0]!))
      .toEqual([f.a, 2, f.shadow, 2]);
    first.remove(); last.remove();
    expect(boundaries(f.selection.getComposedRanges({ shadowRoots: [f.shadow] })[0]!))
      .toEqual([f.a, 1, f.shadow, 1]);
  });

  it.each(['start', 'end'] as const)('clears when the %s composed endpoint loses its shadow host', (endpoint) => {
    const f = createCrossRootFixture();
    if (endpoint === 'start') f.selection.setBaseAndExtent(f.shadowText, 1, f.b.firstChild!, 2);
    f.loop.runTaskTurn();
    f.host.remove(); f.root.appendChild(f.host);
    expect(state(f.selection)).toEqual([null, 0, null, 0, true, 0, 'None', 'none']);
    expect(f.selection.getComposedRanges({ shadowRoots: [f.shadow] })).toEqual([]);
    expect(f.loop.runTaskTurn()).toBe(true);
    f.text.insertData(0, '+'); f.shadowText.insertData(0, '+');
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it.each(['setStart', 'setEnd', 'collapse', 'selectNodeContents'] as const)(
    '%s on the public Range replaces the composed span and detaches its trackers', (method) => {
      const f = createCrossRootFixture();
      const range = f.selection.getRangeAt(0);
      f.loop.runTaskTurn();
      if (method === 'setStart') range.setStart(f.shadowText, 4);
      else if (method === 'setEnd') range.setEnd(f.shadowText, 4);
      else if (method === 'collapse') range.collapse(true);
      else range.selectNodeContents(f.shadowText);
      expect(f.selection.getRangeAt(0)).toBe(range);
      expect(boundaries(f.selection.getComposedRanges({ shadowRoots: [f.shadow] })[0]!)).toEqual(boundaries(range));
      expect(f.selection.direction).toBe('forward');
      expect(f.loop.runTaskTurn()).toBe(true);
      f.text.insertData(0, '+');
      expect(f.loop.runTaskTurn()).toBe(false);
    },
  );

  it.each(['clear', 'collapse', 'replace'] as const)('%s severs every old composed association', (method) => {
    const f = createCrossRootFixture();
    const old = f.selection.getRangeAt(0);
    if (method === 'clear') f.selection.removeAllRanges();
    else if (method === 'collapse') f.selection.collapse(f.b.firstChild, 1);
    else f.selection.setBaseAndExtent(f.b.firstChild!, 1, f.b.firstChild!, 2);
    f.loop.runTaskTurn();
    old.setStart(f.shadowText, 1); f.text.insertData(0, '+'); f.shadowText.insertData(0, '+');
    expect(f.loop.runTaskTurn()).toBe(false);
    expect(f.selection.getComposedRanges().length).toBe(method === 'clear' ? 0 : 1);
  });

  it('notifies hidden endpoint changes and ignores an identical composed replacement', () => {
    const f = createCrossRootFixture();
    const old = f.selection.getRangeAt(0);
    f.loop.runTaskTurn();
    f.selection.setBaseAndExtent(f.text, 1, f.shadowText, 4);
    expect(f.selection.getRangeAt(0)).not.toBe(old);
    expect(f.loop.runTaskTurn()).toBe(false);
    f.selection.setBaseAndExtent(f.text, 2, f.shadowText, 4);
    expect(boundaries(f.selection.getRangeAt(0))).toEqual([f.shadowText, 4, f.shadowText, 4]);
    expect(f.loop.runTaskTurn()).toBe(true);
    f.text.insertData(0, '+');
    expect(f.loop.runTaskTurn()).toBe(true);
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it('preserves the composed endpoints and reverses direction when moveBefore reverses their order', () => {
    const f = createCrossRootFixture();
    const range = f.selection.getRangeAt(0);
    f.loop.runTaskTurn();
    f.root.moveBefore(f.host, f.a);
    expect(boundaries(f.selection.getComposedRanges({ shadowRoots: [f.shadow] })[0]!))
      .toEqual([f.shadowText, 4, f.text, 1]);
    expect(state(f.selection)).toEqual([f.text, 1, f.text, 1, true, 1, 'Caret', 'backward']);
    expect(f.selection.getRangeAt(0)).toBe(range);
    expect(f.loop.runTaskTurn()).toBe(true);
    f.root.moveBefore(f.host, f.b);
    expect(boundaries(f.selection.getComposedRanges({ shadowRoots: [f.shadow] })[0]!))
      .toEqual([f.text, 1, f.shadowText, 4]);
    expect(f.selection.direction).toBe('forward');
    expect(boundaries(range)).toEqual([f.shadowText, 4, f.shadowText, 4]);
  });

  it('does not clear a shadow endpoint while a state-preserving move adjusts the other endpoint', () => {
    const f = createCrossRootFixture();
    const index = Array.from(f.root.childNodes).indexOf(f.host);
    f.selection.setBaseAndExtent(f.shadowText, 1, f.root, index + 1);
    f.root.moveBefore(f.host, f.a);
    expect(f.selection.rangeCount).toBe(1);
    expect(boundaries(f.selection.getComposedRanges({ shadowRoots: [f.shadow] })[0]!))
      .toEqual([f.shadowText, 1, f.root, index + 1]);
  });

  it.each(['collapseToStart', 'collapseToEnd'] as const)('%s uses the ordinary Range and discards the composed span', (method) => {
    const f = createCrossRootFixture();
    const old = f.selection.getRangeAt(0);
    f.selection[method]();
    expect(state(f.selection)).toEqual([f.shadowText, 4, f.shadowText, 4, true, 1, 'Caret', 'none']);
    expect(boundaries(f.selection.getComposedRanges({ shadowRoots: [f.shadow] })[0]!))
      .toEqual([f.shadowText, 4, f.shadowText, 4]);
    expect(f.selection.getRangeAt(0)).not.toBe(old);
    f.loop.runTaskTurn();
    f.text.insertData(0, '+');
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it.each([false, true])('extends from the ordinary anchor and replaces the composed span (new root=%s)', (newRoot) => {
    const f = createCrossRootFixture();
    const old = f.selection.getRangeAt(0);
    const focus = newRoot ? f.b.firstChild! : f.shadowText;
    f.selection.extend(focus, 2);
    expect(state(f.selection)).toEqual(newRoot ? [focus, 2, focus, 2, true, 1, 'Caret', 'none'] :
      [f.shadowText, 4, f.shadowText, 2, false, 1, 'Range', 'backward']);
    expect(boundaries(f.selection.getComposedRanges({ shadowRoots: [f.shadow] })[0]!))
      .toEqual(newRoot ? [focus, 2, focus, 2] : [f.shadowText, 2, f.shadowText, 4]);
    expect(f.selection.getRangeAt(0)).not.toBe(old);
    f.loop.runTaskTurn();
    f.text.insertData(0, '+');
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it('does not change the live state on invalid cross-root endpoints', () => {
    const f = createCrossRootFixture();
    const range = f.selection.getRangeAt(0);
    expect(() => f.selection.setBaseAndExtent(f.text, 1, f.shadowText, 99))
      .toThrow(expect.objectContaining({ name: 'IndexSizeError' }));
    expect(f.selection.getRangeAt(0)).toBe(range);
    expect(boundaries(f.selection.getComposedRanges({ shadowRoots: [f.shadow] })[0]!))
      .toEqual([f.text, 1, f.shadowText, 4]);
  });
});

describe('Selection API §3: selecting all children', () => {
  it('replaces the old Range with direct child boundaries and forward direction', () => {
    const f = createFixture();
    const nested = f.document.createElement('span'); nested.append('one', f.document.createElement('i'), 'two');
    f.a.append(nested, f.document.createComment('three'));
    f.selection.setBaseAndExtent(f.text, 3, f.text, 1);
    const old = f.selection.getRangeAt(0);
    f.loop.runTaskTurn();
    expect(f.selection.selectAllChildren(f.a)).toBeUndefined();
    expect(state(f.selection)).toEqual([f.a, 0, f.a, 3, false, 1, 'Range', 'forward']);
    expect(f.selection.getRangeAt(0)).not.toBe(old);
    expect(boundaries(old)).toEqual([f.text, 1, f.text, 3]);
    expect(f.loop.runTaskTurn()).toBe(true);
    old.setStart(f.text, 0);
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it.each(['element', 'text', 'comment', 'instruction'] as const)('uses zero child boundaries for a childless %s', (kind) => {
    const f = createFixture();
    const node = kind === 'element' ? f.document.createElement('span') : kind === 'text' ? f.text :
      kind === 'comment' ? f.document.createComment('nonempty') : f.document.createProcessingInstruction('target', 'nonempty');
    if (!node.isConnected) f.a.appendChild(node);
    f.selection.selectAllChildren(node);
    expect(state(f.selection)).toEqual([node, 0, node, 0, true, 1, 'Caret', 'forward']);
  });

  it('selects Document children, including its DocumentType', () => {
    const f = createFixture();
    if (f.document.doctype === null) f.document.insertBefore(f.document.implementation.createDocumentType('html', '', ''), f.root);
    f.selection.selectAllChildren(f.document);
    expect(boundaries(f.selection.getRangeAt(0))).toEqual([f.document, 0, f.document, f.document.childNodes.length]);
    expect(f.selection.direction).toBe('forward');
  });

  it.each(['root', 'element', 'text'] as const)('selects a connected closed-shadow %s and detaches the old composed span', (kind) => {
    const f = createCrossRootFixture();
    const node = kind === 'root' ? f.shadow : kind === 'element' ? f.span : f.shadowText;
    const count = kind === 'text' ? 0 : 1;
    const old = f.selection.getRangeAt(0);
    f.selection.selectAllChildren(node);
    expect(state(f.selection)).toEqual([node, 0, node, count, count === 0, 1, count === 0 ? 'Caret' : 'Range', 'forward']);
    expect(boundaries(f.selection.getComposedRanges({ shadowRoots: [f.shadow] })[0]!)).toEqual([node, 0, node, count]);
    expect(f.selection.getRangeAt(0)).not.toBe(old);
    f.loop.runTaskTurn();
    f.text.insertData(0, '+');
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it('ignores detached, foreign, and attribute nodes without clearing Selection', () => {
    const f = createFixture();
    const other = createFixture(f.userAgent);
    const detached = f.document.createElement('div');
    const shadow = detached.attachShadow({ mode: 'closed' });
    const fragment = f.document.createDocumentFragment();
    const range = selectedRange(f); f.loop.runTaskTurn();
    for (const node of [detached, shadow, fragment, other.text, f.document.createAttribute('name')]) {
      f.selection.selectAllChildren(node);
      expect(f.selection.getRangeAt(0)).toBe(range);
      expect(boundaries(range)).toEqual([f.text, 1, f.text, 3]);
    }
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it('rejects DocumentType before membership and invalid author arguments during conversion', () => {
    const f = createFixture(); const range = selectedRange(f); f.loop.runTaskTurn();
    const doctype = f.document.implementation.createDocumentType('html', '', '');
    expect(() => f.selection.selectAllChildren(doctype)).toThrow(expect.objectContaining({ name: 'InvalidNodeTypeError' }));
    for (const args of [[], [null], [{}]]) {
      expect(() => f.selection.selectAllChildren(...args as [Node])).toThrow(f.documentImpl.env.realm.TypeError);
    }
    expect(f.selection.getRangeAt(0)).toBe(range);
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it('replaces an identical Range silently but notifies a direction-only change', () => {
    const f = createFixture();
    f.selection.setBaseAndExtent(f.a, 1, f.a, 0); f.loop.runTaskTurn();
    f.selection.selectAllChildren(f.a);
    expect(f.loop.runTaskTurn()).toBe(true);
    const old = f.selection.getRangeAt(0);
    f.selection.selectAllChildren(f.a);
    expect(f.selection.getRangeAt(0)).not.toBe(old);
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it('keeps a borrowed result in the receiver realm and exceptions in the method realm', () => {
    const f = createFixture(); const other = createFixture(f.userAgent);
    other.window.Selection.prototype.selectAllChildren.call(f.selection, f.a);
    expect(f.selection.getRangeAt(0)).toBeInstanceOf(f.window.Range);
    expect(f.selection.getRangeAt(0)).not.toBeInstanceOf(other.window.Range);
    const doctype = f.document.implementation.createDocumentType('html', '', '');
    expect(() => other.window.Selection.prototype.selectAllChildren.call(f.selection, doctype)).toThrow(other.window.DOMException);
  });
});

describe('Selection API §3: modify validation and rendered movement dependency', () => {
  it.each([{ count: 0, args: [] }, { count: 1, args: ['move'] }, { count: 2, args: ['move', 'forward'] }] as const)(
    'omitted arguments leave a selection unchanged ($count supplied)', ({ args }) => {
      const f = createCrossRootFixture(); const range = f.selection.getRangeAt(0); f.loop.runTaskTurn();
      expect(f.selection.modify.length).toBe(0);
      expect(f.selection.modify(...args)).toBeUndefined();
      expect(f.selection.getRangeAt(0)).toBe(range);
      expect(boundaries(f.selection.getComposedRanges({ shadowRoots: [f.shadow] })[0]!)).toEqual([f.text, 1, f.shadowText, 4]);
      expect(f.loop.runTaskTurn()).toBe(false);
    },
  );

  it.each([
    ['select', 'forward', 'character'], [' move', 'forward', 'character'], ['move', 'up', 'character'],
    ['move', 'forward ', 'character'], ['move', 'forward', 'codepoint'], ['move', 'forward', 'character '],
    ['move', 'forward', 'ſentence'],
  ])('rejects unsupported strings without changing selection: %s %s %s', (alter, direction, granularity) => {
    const f = createFixture(); const range = selectedRange(f); f.loop.runTaskTurn();
    const before = state(f.selection);
    expect(f.selection.modify(alter, direction, granularity)).toBeUndefined();
    expect(f.selection.getRangeAt(0)).toBe(range);
    expect(state(f.selection)).toEqual(before);
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it('ignores the specified movement requests while Selection is empty', () => {
    const f = createFixture();
    for (const alter of ['move', 'extend']) {
      for (const direction of ['forward', 'backward', 'left', 'right']) {
        for (const granularity of ['character', 'word', 'sentence', 'line', 'paragraph',
          'lineboundary', 'sentenceboundary', 'paragraphboundary', 'documentboundary']) {
          expect(f.selection.modify(alter.toUpperCase(), direction.toUpperCase(), granularity.toUpperCase())).toBeUndefined();
        }
      }
    }
    expect(state(f.selection)).toEqual([null, 0, null, 0, true, 0, 'None', 'none']);
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it('converts every supplied DOMString before algorithm validation', () => {
    const f = createFixture(); const trace: string[] = [];
    const argument = (name: string, value: string) => ({ toString() { trace.push(name); return value; } }) as unknown as string;
    f.selection.modify(argument('alter', 'invalid'), argument('direction', 'forward'), argument('granularity', 'character'));
    expect(trace).toEqual(['alter', 'direction', 'granularity']);
    expect(() => f.selection.modify('invalid', Symbol() as unknown as string, 'character')).toThrow(f.documentImpl.env.realm.TypeError);
  });

  it('reads empty state after conversion reentrantly clears a composed selection', () => {
    const f = createCrossRootFixture();
    f.selection.modify('move', 'forward', {
      toString() { f.selection.removeAllRanges(); return 'character'; },
    } as unknown as string);
    expect(f.selection.rangeCount).toBe(0);
    f.loop.runTaskTurn();
    f.text.insertData(0, '+'); f.shadowText.insertData(0, '+');
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it('uses the borrowed method realm for conversion errors', () => {
    const f = createFixture(); const other = createFixture(f.userAgent);
    expect(() => other.window.Selection.prototype.modify.call(f.selection, Symbol() as unknown as string, 'forward', 'character'))
      .toThrow(other.documentImpl.env.realm.TypeError);
  });

  // TODO(Selection / editing and text layout): both required movement results were
  // observed failing at the named dependency. Eric approved these expected failures.
  it.fails('moves the caret forward by a rendered character', () => {
    const f = createFixture();
    f.selection.collapse(f.text, 1);
    f.selection.modify('MoVe', 'FoRwArD', 'ChArAcTeR');
    expect([f.selection.anchorNode, f.selection.anchorOffset, f.selection.focusNode, f.selection.focusOffset])
      .toEqual([f.text, 2, f.text, 2]);
  });

  it.fails('extends right using the resolved bidi direction at the caret', () => {
    const f = createFixture();
    f.selection.collapse(f.text, 1);
    f.selection.modify('extend', 'right', 'character');
    expect([f.selection.anchorNode, f.selection.anchorOffset, f.selection.focusNode, f.selection.focusOffset])
      .toEqual([f.text, 1, f.text, 2]);
  });
});

describe('Selection API §3: deleting selected content', () => {
  it('does nothing for an empty selection or ordinary caret', () => {
    const f = createFixture();
    expect(f.selection.deleteFromDocument.length).toBe(0);
    expect(f.selection.deleteFromDocument()).toBeUndefined();
    expect(f.selection.rangeCount).toBe(0);
    expect(f.loop.runTaskTurn()).toBe(false);
    f.selection.collapse(f.text, 2);
    const range = f.selection.getRangeAt(0); f.loop.runTaskTurn();
    f.selection.deleteFromDocument();
    expect(f.text.data).toBe('abcd');
    expect(boundaries(range)).toEqual([f.text, 2, f.text, 2]);
    expect(f.selection.getRangeAt(0)).toBe(range);
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it.each(['forward', 'backward'] as const)('mutates the same Range and preserves %s direction', (direction) => {
    const f = createFixture();
    f.selection.setBaseAndExtent(f.text, direction === 'forward' ? 1 : 3, f.text, direction === 'forward' ? 3 : 1);
    const range = f.selection.getRangeAt(0); f.loop.runTaskTurn();
    f.selection.deleteFromDocument();
    expect(f.text.data).toBe('ad');
    expect(f.selection.getRangeAt(0)).toBe(range);
    expect(state(f.selection)).toEqual([f.text, 1, f.text, 1, true, 1, 'Caret', direction]);
    expect(f.loop.runTaskTurn()).toBe(true);
    expect(f.loop.runTaskTurn()).toBe(false);
    range.setEnd(f.text, 2);
    expect(f.selection.isCollapsed).toBe(false);
    expect(f.loop.runTaskTurn()).toBe(true);
  });

  it('removes whole intermediate nodes and selected prefixes/suffixes with one notification', () => {
    const f = createFixture();
    const middle = f.document.createElement('strong'); middle.textContent = 'middle';
    f.root.insertBefore(middle, f.b);
    f.selection.setBaseAndExtent(f.text, 1, f.b.firstChild!, 2);
    const range = f.selection.getRangeAt(0); f.loop.runTaskTurn();
    f.selection.deleteFromDocument();
    expect(f.a.textContent).toBe('a');
    expect(f.b.textContent).toBe('gh');
    expect(middle.isConnected).toBe(false);
    const offset = Array.from(f.root.childNodes).indexOf(f.b);
    expect(boundaries(range)).toEqual([f.root, offset, f.root, offset]);
    expect(f.selection.getRangeAt(0)).toBe(range);
    expect(f.loop.runTaskTurn()).toBe(true);
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it.each(['comment', 'instruction'] as const)('deletes a selected %s through CharacterData mutation', (kind) => {
    const f = createFixture();
    const node = kind === 'comment' ? f.document.createComment('abcd') : f.document.createProcessingInstruction('target', 'abcd');
    f.a.appendChild(node); f.selection.setBaseAndExtent(node, 1, node, 3);
    const range = f.selection.getRangeAt(0); f.loop.runTaskTurn();
    f.selection.deleteFromDocument();
    expect(node.data).toBe('ad');
    expect(boundaries(range)).toEqual([node, 1, node, 1]);
    expect(f.selection.getRangeAt(0)).toBe(range);
    expect(f.loop.runTaskTurn()).toBe(true);
  });

  it('deletes inside a connected shadow root without replacing the Range', () => {
    const f = createCrossRootFixture();
    f.selection.setBaseAndExtent(f.shadowText, 4, f.shadowText, 1);
    const range = f.selection.getRangeAt(0); f.loop.runTaskTurn();
    f.selection.deleteFromDocument();
    expect(f.shadowText.data).toBe('sow');
    expect(f.selection.getRangeAt(0)).toBe(range);
    expect(state(f.selection)).toEqual([f.shadowText, 1, f.shadowText, 1, true, 1, 'Caret', 'backward']);
    expect(f.loop.runTaskTurn()).toBe(true);
  });

  it('leaves a cross-root span and its live endpoint associations intact', () => {
    const f = createCrossRootFixture(); const range = f.selection.getRangeAt(0); f.loop.runTaskTurn();
    f.selection.deleteFromDocument();
    expect(f.text.data).toBe('abcd'); expect(f.shadowText.data).toBe('shadow');
    expect(f.selection.getRangeAt(0)).toBe(range);
    expect(boundaries(f.selection.getComposedRanges({ shadowRoots: [f.shadow] })[0]!)).toEqual([f.text, 1, f.shadowText, 4]);
    expect(f.loop.runTaskTurn()).toBe(false);
    f.text.insertData(0, '+');
    expect(boundaries(f.selection.getComposedRanges({ shadowRoots: [f.shadow] })[0]!)).toEqual([f.text, 2, f.shadowText, 4]);
    expect(f.loop.runTaskTurn()).toBe(true);
  });

  it('preserves a foreign-created Range and uses the borrowed receiver Selection', () => {
    const f = createFixture(); const other = createFixture(f.userAgent);
    const range = other.document.createRange(); range.setStart(f.text, 1); range.setEnd(f.text, 3);
    f.selection.addRange(range);
    other.window.Selection.prototype.deleteFromDocument.call(f.selection);
    expect(f.text.data).toBe('ad'); expect(other.text.data).toBe('abcd');
    expect(f.selection.getRangeAt(0)).toBe(range);
    expect(range).toBeInstanceOf(other.window.Range);
    expect(() => other.window.Selection.prototype.deleteFromDocument.call({} as Selection)).toThrow(other.documentImpl.env.realm.TypeError);
  });
});

describe('Selection API §3: node containment', () => {
  it('requires a node even for empty Selection and defaults partial containment to false', () => {
    const f = createFixture();
    expect(f.selection.containsNode.length).toBe(1);
    expect(f.selection.containsNode(f.a)).toBe(false);
    for (const args of [[], [null], [{}]]) {
      expect(() => f.selection.containsNode(...args as [Node])).toThrow(f.documentImpl.env.realm.TypeError);
    }
    selectedRange(f); f.loop.runTaskTurn();
    expect(f.selection.containsNode(f.text)).toBe(false);
    expect(f.selection.containsNode(f.text, undefined)).toBe(false);
    expect(f.selection.containsNode(f.text, true)).toBe(true);
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it('distinguishes selecting an entire node from selecting all its children', () => {
    const f = createFixture(); const range = f.document.createRange();
    range.selectNode(f.a); f.selection.addRange(range);
    expect([f.selection.containsNode(f.a), f.selection.containsNode(f.text), f.selection.containsNode(f.b)])
      .toEqual([true, true, false]);
    f.selection.selectAllChildren(f.a);
    expect([f.selection.containsNode(f.a), f.selection.containsNode(f.a, true), f.selection.containsNode(f.text)])
      .toEqual([false, true, true]);
    f.selection.setBaseAndExtent(f.text, 0, f.text, f.text.length);
    expect([f.selection.containsNode(f.text), f.selection.containsNode(f.text, true)]).toEqual([false, true]);
  });

  it.each(['text', 'comment', 'instruction'] as const)('requires full enclosure of a partially selected %s too', (kind) => {
    const f = createFixture();
    const node = kind === 'text' ? f.text : kind === 'comment' ? f.document.createComment('abcd') :
      f.document.createProcessingInstruction('target', 'abcd');
    if (!node.isConnected) f.a.appendChild(node);
    f.selection.setBaseAndExtent(node, 1, node, 3);
    expect(f.selection.containsNode(node)).toBe(false);
    expect(f.selection.containsNode(node, true)).toBe(true);
    f.selection.collapse(node, 2);
    expect(f.selection.containsNode(node)).toBe(false);
    expect(f.selection.containsNode(node, true)).toBe(true);
  });

  it('does not count touching outer edges as partial containment', () => {
    const f = createFixture(); const range = f.document.createRange();
    range.setStartBefore(f.a); range.collapse(true); f.selection.addRange(range);
    expect(f.selection.containsNode(f.a, true)).toBe(false);
    range.setStartAfter(f.a); range.collapse(true);
    expect(f.selection.containsNode(f.a, true)).toBe(false);
    f.selection.collapse(f.text, 2);
    expect(f.selection.containsNode(f.a, true)).toBe(true);
    expect(f.selection.containsNode(f.a)).toBe(false);
  });

  it('distinguishes a caret in an empty element from selection of the element itself', () => {
    const f = createFixture(); const empty = f.document.createElement('i'); f.a.appendChild(empty);
    f.selection.selectAllChildren(empty);
    expect([f.selection.containsNode(empty), f.selection.containsNode(empty, true)]).toEqual([false, true]);
    f.selection.getRangeAt(0).selectNode(empty);
    expect([f.selection.containsNode(empty), f.selection.containsNode(empty, true)]).toEqual([true, true]);
  });

  it('handles Document and DocumentType without invalid Range boundary operations', () => {
    const f = createFixture();
    const doctype = f.document.doctype ?? f.document.insertBefore(f.document.implementation.createDocumentType('html', '', ''), f.root);
    f.selection.selectAllChildren(f.document);
    expect([f.selection.containsNode(f.document), f.selection.containsNode(f.document, true)]).toEqual([false, true]);
    expect([f.selection.containsNode(doctype), f.selection.containsNode(doctype, true)]).toEqual([true, true]);
    f.selection.setBaseAndExtent(f.text, 1, f.text, 3);
    expect(f.selection.containsNode(doctype, true)).toBe(false);
  });

  it('rejects detached, foreign, attribute, and shadow-tree membership', () => {
    const f = createCrossRootFixture(); const other = createFixture(f.userAgent);
    f.selection.selectAllChildren(f.document);
    for (const node of [f.document.createElement('div'), f.document.createDocumentFragment(), f.document.createAttribute('name'),
      other.a, f.shadow, f.span, f.shadowText]) {
      expect(f.selection.containsNode(node)).toBe(false);
      expect(f.selection.containsNode(node, true)).toBe(false);
    }
    f.selection.setBaseAndExtent(f.shadowText, 1, f.shadowText, 4);
    expect(f.selection.containsNode(f.document, true)).toBe(false);
    expect(f.selection.containsNode(f.shadowText, true)).toBe(false);
  });

  it('uses only the exposed ordinary Range for a cross-root span', () => {
    const f = createCrossRootFixture();
    expect(f.selection.containsNode(f.a, true)).toBe(false);
    f.selection.setBaseAndExtent(f.shadowText, 1, f.b.firstChild!, 2);
    const before = boundaries(f.selection.getComposedRanges({ shadowRoots: [f.shadow] })[0]!); f.loop.runTaskTurn();
    expect(f.selection.containsNode(f.host, true)).toBe(false);
    expect(f.selection.containsNode(f.b, true)).toBe(true);
    expect(f.selection.containsNode(f.b)).toBe(false);
    expect(boundaries(f.selection.getComposedRanges({ shadowRoots: [f.shadow] })[0]!)).toEqual(before);
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it('uses Web IDL boolean conversion without invoking object coercion', () => {
    const f = createFixture(); selectedRange(f);
    const coercion = vi.fn(() => { throw new Error('boolean conversion must not call this'); });
    expect(f.selection.containsNode(f.text, { valueOf: coercion, toString: coercion } as unknown as boolean)).toBe(true);
    expect(f.selection.containsNode(f.text, Symbol() as unknown as boolean)).toBe(true);
    expect(f.selection.containsNode(f.text, 0 as unknown as boolean)).toBe(false);
    expect(coercion).not.toHaveBeenCalled();
  });

  it('uses the borrowed receiver and the method realm for conversion errors', () => {
    const f = createFixture(); const other = createFixture(f.userAgent); selectedRange(f);
    expect(other.window.Selection.prototype.containsNode.call(f.selection, f.text, true)).toBe(true);
    expect(other.window.Selection.prototype.containsNode.call(f.selection, other.text, true)).toBe(false);
    expect(() => other.window.Selection.prototype.containsNode.call(f.selection, null as unknown as Node))
      .toThrow(other.documentImpl.env.realm.TypeError);
    expect(() => f.selection.containsNode.call({} as Selection, f.text)).toThrow(f.documentImpl.env.realm.TypeError);
  });
});

describe('Selection API §3: rendered-text stringification dependency', () => {
  it('stringifies empty and ordinary caret selections without changing state', () => {
    const f = createFixture();
    expect(f.selection.toString.length).toBe(0);
    expect(f.selection.toString()).toBe('');
    expect(String(f.selection)).toBe('');
    expect(f.loop.runTaskTurn()).toBe(false);
    f.selection.collapse(f.text, 2);
    const range = f.selection.getRangeAt(0); f.loop.runTaskTurn();
    expect(String(f.selection)).toBe('');
    expect(f.selection.getRangeAt(0)).toBe(range);
    expect(f.selection.direction).toBe('none');
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it('uses the borrowed stringifier receiver and method-realm errors', () => {
    const f = createFixture(); const other = createFixture(f.userAgent);
    expect(other.window.Selection.prototype.toString.call(f.selection)).toBe('');
    expect(() => other.window.Selection.prototype.toString.call({} as Selection)).toThrow(other.documentImpl.env.realm.TypeError);
  });

  // TODO(Selection / rendering): these required results were observed failing at
  // the named dependency. Eric approved retaining both as expected failures.
  it.fails('omits hidden content from rendered selected text', () => {
    const f = createFixture();
    const hidden = f.document.createElement('span'); hidden.setAttribute('hidden', ''); hidden.textContent = 'hidden';
    f.a.replaceChildren('a', hidden, 'b'); f.selection.selectAllChildren(f.a);
    expect(f.selection.toString()).toBe('ab');
  });

  it.fails('collapses whitespace in rendered selected text', () => {
    const f = createFixture(); f.text.data = 'alpha  beta'; f.selection.selectAllChildren(f.a);
    expect(f.selection.toString()).toBe('alpha beta');
  });
});

describe('Selection API §§4.3, 6.2: Selection event-handler delivery', () => {
  it('delivers coalesced changes to the current Document handler without starting a user selection', () => {
    const f = createFixture();
    const start = vi.fn();
    const elsewhere = vi.fn();
    const oldHandler = vi.fn();
    const events: unknown[] = [];
    f.document.onselectstart = start;
    f.document.onselectionchange = oldHandler;
    f.window.onselectionchange = elsewhere;
    Reflect.set(f.a, 'onselectionchange', elsewhere);
    f.selection.collapse(f.text, 1);
    f.selection.collapse(f.text, 2);
    f.document.onselectionchange = function(event) {
      events.push([this === f.document, event.target === f.document, event.isTrusted,
        event.bubbles, event.cancelable, event.composed, f.selection.focusOffset]);
      return false;
    };
    expect(events).toEqual([]);
    expect(f.loop.runTaskTurn()).toBe(true);
    expect(events).toEqual([[true, true, true, false, false, false, 2]]);
    expect(oldHandler).not.toHaveBeenCalled();
    expect(elsewhere).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it('permits reentrant handler changes and observes removal before the next queued task', () => {
    const f = createFixture();
    const events: number[] = [];
    f.document.onselectionchange = () => {
      events.push(f.selection.focusOffset);
      f.document.onselectionchange = () => { events.push(f.selection.focusOffset); };
      f.selection.collapse(f.text, 3);
    };
    f.selection.collapse(f.text, 1);
    expect(f.loop.runTaskTurn()).toBe(true);
    expect(events).toEqual([1]);
    expect(f.loop.runTaskTurn()).toBe(true);
    expect(events).toEqual([1, 3]);
    f.selection.collapse(f.text, 4);
    f.document.onselectionchange = null;
    expect(f.loop.runTaskTurn()).toBe(true);
    expect(events).toEqual([1, 3]);
    expect(f.loop.runTaskTurn()).toBe(false);
  });
});

describe('Selection API §§5–6.2: live boundaries and queued changes', () => {
  it('coalesces changes into one trusted, non-bubbling Document event on the user-interaction task source', () => {
    const f = createFixture();
    const events: unknown[] = [];
    f.document.addEventListener('selectionchange', (event) => events.push([
      event.target === f.document, event.isTrusted, event.bubbles, event.cancelable, event.composed,
      f.selection.anchorOffset, f.selection.focusOffset,
    ]));
    const bubbled = vi.fn();
    f.window.addEventListener('selectionchange', bubbled);
    const range = selectedRange(f);
    range.setStart(f.text, 2);
    range.setEnd(f.text, 4);
    expect(events).toEqual([]);
    const tasks = [...f.loop.getTaskQueue(userInteractionTaskSource)];
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.document).toBe(f.documentImpl);
    expect(f.loop.runTaskTurn()).toBe(true);
    expect(events).toEqual([[true, true, false, false, false, 2, 4]]);
    expect(bubbled).not.toHaveBeenCalled();
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it('does not notify unchanged setters, rejected additions, clones, or unrelated tree edits', () => {
    const f = createFixture();
    const range = selectedRange(f);
    f.loop.runTaskTurn();
    range.setStart(f.text, 1);
    range.setEnd(f.text, 3);
    range.cloneRange().collapse(true);
    f.selection.addRange(range);
    f.b.appendChild(f.document.createTextNode('unrelated'));
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it('clears the scheduled flag before dispatch so a listener can queue another change', () => {
    const f = createFixture();
    const range = selectedRange(f);
    let calls = 0;
    f.document.addEventListener('selectionchange', () => {
      if (++calls === 1) range.setEnd(f.text, 4);
    });
    expect(f.loop.runTaskTurn()).toBe(true);
    expect(calls).toBe(1);
    expect(f.loop.runTaskTurn()).toBe(true);
    expect(calls).toBe(2);
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it('moves notification ownership when a Range leaves one Document and is selected in another', () => {
    const first = createFixture();
    const second = createFixture(first.userAgent);
    const range = selectedRange(first);
    first.loop.runTaskTurn();
    const firstChange = vi.fn();
    const secondChange = vi.fn();
    first.document.addEventListener('selectionchange', firstChange);
    second.document.addEventListener('selectionchange', secondChange);
    range.selectNodeContents(second.text);
    expect(first.selection.rangeCount).toBe(0);
    second.selection.addRange(range);
    first.loop.runTaskTurn();
    second.loop.runTaskTurn();
    expect(firstChange).toHaveBeenCalledOnce();
    expect(secondChange).toHaveBeenCalledOnce();
    range.setEnd(second.text, 2);
    expect(first.loop.runTaskTurn()).toBe(false);
    second.loop.runTaskTurn();
    expect(firstChange).toHaveBeenCalledOnce();
    expect(secondChange).toHaveBeenCalledTimes(2);
    expect(second.selection.getRangeAt(0)).toBe(range);
  });

  it('clears a selected Range moved into a detached ordinary tree without restoring it on insertion', () => {
    const f = createFixture();
    const range = selectedRange(f);
    f.loop.runTaskTurn();
    const detached = f.document.createTextNode('detached');
    range.selectNodeContents(detached);
    expect(f.selection.rangeCount).toBe(0);
    f.a.appendChild(detached);
    expect(f.selection.rangeCount).toBe(0);
    expect(f.loop.runTaskTurn()).toBe(true);
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it('follows live endpoints into a shadow tree, then clears immediately when its host is removed', () => {
    const f = createFixture();
    const host = f.document.createElement('div');
    f.root.appendChild(host);
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.textContent = 'shadow';
    const range = selectedRange(f);
    f.loop.runTaskTurn();
    range.selectNodeContents(shadow.firstChild!);
    expect(f.selection.getRangeAt(0)).toBe(range);
    expect(state(f.selection)).toEqual([shadow.firstChild, 0, shadow.firstChild, 6, false, 1, 'Range', 'forward']);
    f.loop.runTaskTurn();
    host.remove();
    expect(f.selection.rangeCount).toBe(0);
    f.root.appendChild(host);
    expect(f.selection.rangeCount).toBe(0);
    expect(f.loop.runTaskTurn()).toBe(true);
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it('keeps shadow selection during state-preserving moves and unrelated removal', () => {
    const f = createFixture();
    const host = f.document.createElement('div');
    f.root.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.textContent = 'shadow';
    const range = selectedRange(f);
    range.selectNodeContents(shadow.firstChild!);
    f.loop.runTaskTurn();
    f.b.moveBefore(host, null);
    f.a.remove();
    expect(f.selection.getRangeAt(0)).toBe(range);
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it('uses the existing DOM removal repair without clearing an ordinary-tree selection', () => {
    const f = createFixture();
    const range = selectedRange(f);
    f.loop.runTaskTurn();
    const index = [...f.root.childNodes].indexOf(f.a);
    f.a.remove();
    expect(f.selection.getRangeAt(0)).toBe(range);
    expect(state(f.selection)).toEqual([f.root, index, f.root, index, true, 1, 'Caret', 'forward']);
    expect(f.loop.runTaskTurn()).toBe(true);
  });

  it('notifies shifted child offsets after insertion', () => {
    const f = createFixture();
    const range = f.document.createRange();
    range.selectNode(f.b);
    f.selection.addRange(range);
    f.loop.runTaskTurn();
    const oldStart = range.startOffset;
    f.root.insertBefore(f.document.createElement('span'), f.a);
    expect(f.selection.anchorOffset).toBe(oldStart + 1);
    expect(f.selection.focusOffset).toBe(oldStart + 2);
    expect(f.loop.runTaskTurn()).toBe(true);
  });

  it('notifies character-data replacement, Text splitting, and normalization', () => {
    const f = createFixture();
    const range = selectedRange(f);
    f.loop.runTaskTurn();
    f.text.replaceData(0, 0, 'XY');
    expect([f.selection.anchorOffset, f.selection.focusOffset]).toEqual([3, 5]);
    expect(f.loop.runTaskTurn()).toBe(true);
    const second = f.text.splitText(2);
    expect(state(f.selection)).toEqual([second, 1, second, 3, false, 1, 'Range', 'forward']);
    expect(f.loop.runTaskTurn()).toBe(true);
    f.a.normalize();
    expect(state(f.selection)).toEqual([f.text, 3, f.text, 5, false, 1, 'Range', 'forward']);
    expect(f.selection.getRangeAt(0)).toBe(range);
    expect(f.loop.runTaskTurn()).toBe(true);
    f.text.replaceData(2, 2, 'Z');
    expect([f.selection.anchorOffset, f.selection.focusOffset]).toEqual([2, 4]);
    expect(f.loop.runTaskTurn()).toBe(true);
  });

  it.each(['deleteContents', 'extractContents'] as const)('notifies %s collapsing a multi-node range', (method) => {
    const f = createFixture();
    const range = selectedRange(f);
    range.setEnd(f.b.firstChild!, 2);
    f.loop.runTaskTurn();
    range[method]();
    expect(f.selection.getRangeAt(0)).toBe(range);
    expect(f.selection.isCollapsed).toBe(true);
    expect(f.selection.type).toBe('Caret');
    expect(f.selection.direction).toBe('forward');
    expect(f.loop.runTaskTurn()).toBe(true);
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it('notifies insertNode extending a collapsed range and surroundContents selecting the new parent', () => {
    const f = createFixture();
    const range = selectedRange(f);
    range.collapse(true);
    f.loop.runTaskTurn();
    const inserted = f.document.createElement('strong');
    inserted.textContent = 'inserted';
    range.insertNode(inserted);
    expect(f.selection.isCollapsed).toBe(false);
    expect(f.loop.runTaskTurn()).toBe(true);
    range.selectNode(inserted);
    f.loop.runTaskTurn();
    const parent = f.document.createElement('em');
    range.surroundContents(parent);
    expect(f.selection.getRangeAt(0)).toBe(range);
    expect(f.selection.anchorNode).toBe(parent.parentNode);
    expect(f.selection.focusOffset).toBe(f.selection.anchorOffset + 1);
    expect(f.loop.runTaskTurn()).toBe(true);
  });
});

/** Real DOM, bindings, and event loop; task turns are advanced explicitly. */
function createFixture(userAgent = createManualUserAgent()) {
  const traversable = TopLevelTraversable.create(userAgent, null, '');
  const documentImpl = traversable.activeDocument!;
  const document = project(documentImpl) as Document;
  const root: Element = document.documentElement ?? document.createElement('html');
  if (!root.isConnected) document.appendChild(root);
  const a = document.createElement('p');
  const b = document.createElement('p');
  const text = document.createTextNode('abcd');
  a.appendChild(text);
  b.textContent = 'efgh';
  root.append(a, b);
  const window = project(traversable.activeWindow!) as Window;
  const selection = document.getSelection()!;
  return {
    userAgent, traversable, documentImpl, document, root, a, b, text, window, selection,
    loop: documentImpl.env.responsibleEventLoop,
  };
}

function createCrossRootFixture() {
  const f = createFixture();
  const host = f.document.createElement('div');
  f.root.insertBefore(host, f.b);
  const shadow = host.attachShadow({ mode: 'closed' });
  const span = f.document.createElement('span');
  const shadowText = f.document.createTextNode('shadow');
  span.appendChild(shadowText); shadow.appendChild(span);
  f.selection.setBaseAndExtent(f.text, 1, shadowText, 4);
  return { ...f, host, shadow, span, shadowText };
}

function selectedRange(f: ReturnType<typeof createFixture>): Range {
  const range = f.document.createRange();
  range.setStart(f.text, 1);
  range.setEnd(f.text, 3);
  f.selection.addRange(range);
  return range;
}

function state(selection: Selection): unknown[] {
  return [selection.anchorNode, selection.anchorOffset, selection.focusNode, selection.focusOffset,
    selection.isCollapsed, selection.rangeCount, selection.type, selection.direction];
}

function boundaries(range: AbstractRange): unknown[] {
  return [range.startContainer, range.startOffset, range.endContainer, range.endOffset];
}
