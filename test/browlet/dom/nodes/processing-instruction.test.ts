import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../../src/browlet/browlet';

describe('ProcessingInstruction', () => {
  it('constructs in the associated document and parses XML pseudo-attributes', () => {
    const browser = new Browlet({ route: () => '' });
    const { ProcessingInstruction, document } = browser.window;
    const pi = new ProcessingInstruction('xml-stylesheet', ' href = "a&amp;b" type=\'text/css\' title="&#x1F600; &#65; &lt;&gt;&quot;&apos;" ');
    expect(pi.ownerDocument).toBe(document);
    expect(pi.nodeName).toBe('xml-stylesheet');
    expect(pi.hasAttributes()).toBe(true);
    expect(pi.getAttributeNames()).toEqual(['href', 'type', 'title']);
    expect(pi.getAttribute('href')).toBe('a&b');
    expect(pi.getAttribute('title')).toBe('😀 A <>"\'');
    expect(pi.getAttribute('absent')).toBeNull();
  });

  it.each([
    'a="1" a="2"', 'a="1"b="2"', 'a="&unknown;"', 'a="&#0;"', 'a="&#xD800;"',
    'a="&#x110000;"', 'a="unterminated', 'a="<"', '1bad="value"', 'a="1"\fb="2"',
  ])('rejects malformed pseudo-attributes atomically: %s', (data) => {
    const browser = new Browlet({ route: () => '' });
    const pi = browser.window.document.createProcessingInstruction('test', data);
    expect(pi.hasAttributes()).toBe(false);
    expect(pi.getAttributeNames()).toEqual([]);
    expect(pi.data).toBe(data);
  });

  it('synchronizes character data and pseudo-attributes through shared mutation records', () => {
    const browser = new Browlet({ route: () => '' });
    const { document, MutationObserver } = browser.window;
    const pi = document.createProcessingInstruction('test', "a='one'");
    const observer = new MutationObserver(() => {});
    observer.observe(pi, { characterData: true, characterDataOldValue: true });
    pi.setAttribute('a', '<&>"');
    pi.setAttribute('b', 'two');
    expect(pi.data).toBe('a="&lt;&amp;&gt;&quot;" b="two"');
    expect(pi.toggleAttribute('b', true)).toBe(true);
    expect(observer.takeRecords().map((record) => record.oldValue)).toEqual(["a='one'", 'a="&lt;&amp;&gt;&quot;"']);
    pi.data = 'next="new"';
    expect(pi.getAttributeNames()).toEqual(['next']);
    pi.appendData(' invalid');
    expect(pi.hasAttributes()).toBe(false);
    pi.setAttribute('recovered', '');
    expect(pi.data).toBe('recovered=""');
    expect(pi.toggleAttribute('recovered')).toBe(false);
    expect(pi.data).toBe('');
    expect(observer.takeRecords()).toHaveLength(4);
  });

  it('uses DOM attribute-name rules for setters and XML Name rules when reparsing', () => {
    const browser = new Browlet({ route: () => '' });
    const pi = browser.window.document.createProcessingInstruction('target', '');
    pi.setAttribute('1valid-in-dom', 'value');
    expect(pi.getAttribute('1valid-in-dom')).toBe('value');
    const serialized = pi.data;
    pi.data = serialized;
    expect(pi.hasAttributes()).toBe(false);
    expect(() => pi.setAttribute('has space', 'value')).toThrow();
    expect(() => pi.toggleAttribute('has space')).toThrow();
  });

  it('validates the XML Name character ranges, including astral characters', () => {
    const browser = new Browlet({ route: () => '' });
    const { ProcessingInstruction } = browser.window;
    for (const target of [':name', '_name', 'xml', '𐀀', 'a\u0300']) {
      expect(new ProcessingInstruction(target).target).toBe(target);
    }
    for (const target of ['', '1name', 'a b', '\uD800', '\u{F0000}', '\u0300']) {
      expect(() => new ProcessingInstruction(target)).toThrow();
    }
  });

  it('rebuilds cloned and imported pseudo-attributes from the copied data', () => {
    const browser = new Browlet({ route: () => '' });
    const { document } = browser.window;
    const source = document.createProcessingInstruction('test', 'a="one"');
    const copy = source.cloneNode() as typeof source;
    const imported = document.importNode(source) as typeof source;
    expect(copy.getAttribute('a')).toBe('one');
    expect(imported.getAttribute('a')).toBe('one');
    copy.setAttribute('a', 'changed');
    expect(source.getAttribute('a')).toBe('one');
    source.setAttribute('1valid-in-dom', 'value');
    expect((source.cloneNode() as typeof source).hasAttributes()).toBe(false);
  });
});
