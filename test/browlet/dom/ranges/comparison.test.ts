import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../../src/browlet/browlet';
import { StaticRangeImpl } from '../../../../src/browlet/dom/ranges/static-range';
import { createTestDocument } from '../../../support/dom';

describe('Range comparison and queries', () => {
  it('exposes comparison constants and selects the specified endpoint pairs', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const text = document.createTextNode('abcdef');
      const range = new Range();
      range.setStart(text, 1);
      range.setEnd(text, 4);
      const source = new Range();
      source.setStart(text, 3);
      source.setEnd(text, 5);
      const constants = [Range.START_TO_START, Range.START_TO_END, Range.END_TO_END, Range.END_TO_START];
      return [constants, constants.map((how) => range.compareBoundaryPoints(how, source)),
        range.START_TO_END, range.compareBoundaryPoints(65536, source),
        range.compareBoundaryPoints(Range.START_TO_START, range)];
    })).toEqual([[0, 1, 2, 3], [-1, 1, -1, -1], 1, -1, 0]);
  });

  it('includes both boundary points when comparing a point or testing membership', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const text = document.createTextNode('abcdef');
      const range = new Range();
      range.setStart(text, 1);
      range.setEnd(text, 4);
      return [0, 1, 2, 3, 4, 5].map((offset) => [range.comparePoint(text, offset), range.isPointInRange(text, offset)]);
    })).toEqual([[-1, false], [0, true], [0, true], [0, true], [0, true], [1, false]]);
  });

  it('orders parent child offsets against positions inside descendants', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const root = document.createElement('div');
      const before = root.appendChild(document.createElement('before'));
      const branch = root.appendChild(document.createElement('branch'));
      const text = branch.appendChild(document.createTextNode('text'));
      const after = root.appendChild(document.createElement('after'));
      const range = new Range();
      range.selectNode(branch);
      const selected = [range.comparePoint(before, 0), range.comparePoint(branch, 0),
        range.comparePoint(text, 0), range.comparePoint(text, 4), range.comparePoint(after, 0)];
      range.selectNodeContents(text);
      return [selected, range.comparePoint(root, 1), range.comparePoint(root, 2),
        range.comparePoint(branch, 0), range.comparePoint(branch, 1)];
    })).toEqual([[-1, 0, 0, 0, 1], -1, 1, -1, 1]);
  });

  it('checks comparison mode and roots before validating a point', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const xml = document.implementation.createDocument(null, 'root');
      const doctype = xml.implementation.createDocumentType('root', '', '');
      xml.insertBefore(doctype, xml.documentElement);
      const range = xml.createRange();
      range.selectNodeContents(xml);
      const other = document.createTextNode('other');
      const otherRange = document.createRange();
      const errors: string[] = [];
      for (const operation of [() => range.compareBoundaryPoints(4, otherRange),
        () => range.compareBoundaryPoints(0, otherRange), () => range.comparePoint(other, 100),
        () => range.comparePoint(doctype, 100), () => range.isPointInRange(doctype, 100),
        () => range.comparePoint(xml, 100), () => range.isPointInRange(xml, -1)]) {
        try { operation(); } catch (error) { errors.push((error as DOMException).name); }
      }
      return [errors, range.isPointInRange(other, 100), range.isPointInRange(document.createAttribute('x'), 100)];
    })).toEqual([['NotSupportedError', 'WrongDocumentError', 'WrongDocumentError',
      'InvalidNodeTypeError', 'InvalidNodeTypeError', 'IndexSizeError', 'IndexSizeError'], false, false]);
  });

  it('distinguishes intersections from touching outside edges, including collapsed ranges and roots', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const root = document.createElement('root');
      const before = root.appendChild(document.createElement('before'));
      const text = root.appendChild(document.createTextNode('text'));
      const after = root.appendChild(document.createElement('after'));
      const detached = document.createElement('detached');
      const range = new Range();
      range.selectNode(text);
      const selected = [root, before, text, after, detached].map((node) => range.intersectsNode(node));
      range.collapse(true);
      const edge = [root, before, text, after].map((node) => range.intersectsNode(node));
      range.setStart(text, 2);
      return [selected, edge, range.intersectsNode(text), range.intersectsNode(root)];
    })).toEqual([[true, false, true, false, false], [true, false, false, false], true, true]);
  });

  it('keeps shadow trees separate from their host when comparing and intersecting', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const host = document.createElement('div');
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.append('shadow');
      host.append('light');
      const range = new Range();
      range.selectNodeContents(shadow);
      return [range.intersectsNode(shadow), range.intersectsNode(shadow.firstChild!),
        range.intersectsNode(host), range.isPointInRange(host, 0), range.toString()];
    })).toEqual([true, true, false, false, 'shadow']);
  });
});

describe('Range cloning and stringification', () => {
  it('clones into an independent live registration that survives root insertion and detach', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const text = document.createTextNode('abcdef');
      const range = new Range();
      range.setStart(text, 1);
      range.setEnd(text, 5);
      const clone = range.cloneRange();
      range.setEnd(text, 3);
      const parent = document.createElement('div');
      parent.appendChild(text);
      clone.detach();
      text.deleteData(1, 2);
      const afterData = [range.startOffset, range.endOffset, clone.startOffset, clone.endOffset];
      parent.removeChild(text);
      return [clone !== range, clone instanceof Range, afterData, clone.startContainer === parent,
        clone.endContainer === parent, clone.startOffset, clone.endOffset];
    })).toEqual([true, true, [1, 1, 1, 3], true, true, 0, 0]);
  });

  it('keeps cloneRange in the receiver realm while content fragments belong to the boundary document', () => {
    const first = new Browlet({ route: () => '' });
    const second = new Browlet({ route: () => '' });
    const text = second.document.createTextNode('text');
    const range = first.document.createRange();
    range.selectNodeContents(text);
    const copy = second.window.Range.prototype.cloneRange.call(range);
    expect(copy).toBeInstanceOf(first.window.Range);
    expect(copy).not.toBeInstanceOf(second.window.Range);
    const fragment = first.window.Range.prototype.cloneContents.call(range);
    expect(fragment).toBeInstanceOf(second.window.DocumentFragment);
    expect(fragment.firstChild).toBeInstanceOf(second.window.Text);
    expect(fragment.ownerDocument).toBe(second.document);
    expect(copy.startContainer).toBe(text);
  });

  it('concatenates selected Text and CDATA code units but excludes comments and instructions', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const xml = document.implementation.createDocument(null, 'root');
      const root = xml.documentElement;
      const first = root.appendChild(xml.createTextNode('a\u{1f600}b'));
      root.appendChild(xml.createComment('ignored'));
      const middle = root.appendChild(xml.createElement('middle'));
      middle.append(xml.createTextNode('C'), xml.createCDATASection('D'));
      root.appendChild(xml.createProcessingInstruction('test', 'ignored'));
      const last = root.appendChild(xml.createTextNode('ef'));
      const range = xml.createRange();
      range.setStart(first, 2);
      range.setEnd(last, 1);
      const partial = String(range);
      range.selectNodeContents(root);
      const whole = String(range);
      range.selectNodeContents(root.childNodes[1]!);
      const comment = String(range);
      range.selectNodeContents(middle.lastChild!);
      const cdata = String(range);
      range.collapse();
      return [partial, whole, comment, cdata, String(range)];
    })).toEqual(['\ude00bCDe', 'a\u{1f600}bCDef', '', 'D', '']);
  });

  it('does not include unselected siblings or a selected host\'s shadow text', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const root = document.createElement('div');
      const host = document.createElement('div');
      host.attachShadow({ mode: 'open' }).append('shadow');
      host.append('light');
      root.append('before', host, 'after');
      const range = new Range();
      range.selectNode(host);
      return String(range);
    })).toBe('light');
  });
});

describe('StaticRange validity', () => {
  it('rechecks order, offsets, and roots against the current tree without changing its snapshot', () => {
    const document = createTestDocument();
    const root = document.createElement('root');
    const first = root.appendChild(document.createTextNode('first'));
    const second = root.appendChild(document.createTextNode('second'));
    const range = new StaticRangeImpl({ startContainer: first, startOffset: 1, endContainer: second, endOffset: 4 }, document.env);
    expect(range.isValid()).toBe(true);
    first.data = '';
    expect(range.isValid()).toBe(false);
    first.data = 'first';
    expect(range.isValid()).toBe(true);
    root.insertBefore(second, first);
    expect(range.isValid()).toBe(false);
    root.appendChild(second);
    expect(range.isValid()).toBe(true);
    root.removeChild(second);
    expect(range.isValid()).toBe(false);
    expect(range.startOffset).toBe(1);
    expect(range.endOffset).toBe(4);
  });
});
