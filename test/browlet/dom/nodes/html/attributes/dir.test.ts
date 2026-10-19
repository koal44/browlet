import { assert, describe, expect, it, vi } from 'vitest';

import { HTML_NAMESPACE, SVG_NAMESPACE, MATHML_NAMESPACE } from '../../../../../../src/infra/index';
import { Browlet } from '../../../../../../src/browlet/browlet';
import { HTMLElementImpl } from '../../../../../../src/browlet/dom/nodes/html/html-element';
import { HTMLInputElementImpl } from '../../../../../../src/browlet/dom/nodes/html/forms/input';
import { HTMLTextAreaElementImpl } from '../../../../../../src/browlet/dom/nodes/html/forms/text-area';
import { createTestDocument, parseTestDocument } from '../../../../../support/dom';

// https://html.spec.whatwg.org/multipage/dom.html#the-dir-attribute
describe('HTML directionality', () => {
  it.each([
    [null, '', 'rtl'], ['', '', 'rtl'], ['ltr', 'ltr', 'ltr'], ['LTR', 'ltr', 'ltr'],
    ['rTl', 'rtl', 'rtl'], ['AUTO', 'auto', 'ltr'], ['ltr ', '', 'rtl'],
    [' auto', '', 'rtl'], ['invalid', '', 'rtl'],
  ])('interprets %j and reflects only known keywords', (raw, reflected, direction) => {
    const document = parseTestDocument('<div dir=rtl><span>A</span></div>');
    const child = document.querySelector('span')!;
    assert(child instanceof HTMLElementImpl);
    if (raw !== null) child.dir = raw;
    expect(child.dir).toBe(reflected);
    expect(child.getAttribute('dir')).toBe(raw);
    expect(child.getDirectionality()).toBe(direction);
  });

  it('inherits through foreign elements without interpreting their dir attributes', () => {
    const document = createTestDocument();
    const parent = document.createElementNS(HTML_NAMESPACE, 'div');
    parent.setAttribute('dir', 'rtl');
    for (const namespace of [SVG_NAMESPACE, MATHML_NAMESPACE, 'urn:other']) {
      const foreign = document.createElementNS(namespace, 'container');
      foreign.setAttribute('dir', 'ltr');
      parent.appendChild(foreign);
      expect(foreign.getDirectionality()).toBe('rtl');
      foreign.remove();
      expect(foreign.getDirectionality()).toBe('ltr');
    }
    const child = document.createElementNS(HTML_NAMESPACE, 'span');
    child.setAttributeNS('urn:other', 'other:dir', 'ltr');
    child.setAttribute('DIR', 'ltr'); // XML attribute names are case-sensitive.
    parent.appendChild(child);
    expect(child.getDirectionality()).toBe('rtl');
  });

  it.each([
    ['<bdi>א</bdi>A', 'ltr'], ['<script>א</script>A', 'ltr'],
    ['<style>א</style>A', 'ltr'], ['<textarea>א</textarea>A', 'ltr'],
    ['<span dir=ltr><i>א</i></span>A', 'ltr'], ['<span dir=auto>א</span>A', 'ltr'],
    ['<span dir=invalid>א</span>A', 'rtl'], ['<svg dir=rtl>A</svg>א', 'ltr'],
    ['<!-- א -->123<span>א</span>A', 'rtl'], ['', 'ltr'], ['123', 'ltr'],
    ['١A', 'ltr'], ['中א', 'ltr'], ['𞤀A', 'rtl'],
  ])('scans eligible text in %s', (markup, direction) => {
    const document = parseTestDocument(`<div dir=rtl><section dir=auto>${markup}</section></div>`);
    expect(document.querySelector('section')!.getDirectionality()).toBe(direction);
  });

  it('updates after text, attribute, ancestry, and input-type changes', () => {
    const document = parseTestDocument('<main dir=auto>A<span></span></main><aside dir=rtl></aside>');
    const main = document.querySelector('main')!;
    const span = document.querySelector('span')!;
    const aside = document.querySelector('aside')!;
    expect(span.getDirectionality()).toBe('ltr');
    main.firstChild!.textContent = 'א';
    expect(span.getDirectionality()).toBe('rtl');
    main.setAttribute('dir', 'ltr');
    expect(span.getDirectionality()).toBe('ltr');
    aside.appendChild(span);
    expect(span.getDirectionality()).toBe('rtl');
    span.remove();
    expect(span.getDirectionality()).toBe('ltr');
    const input = document.createElement('input');
    aside.appendChild(input);
    input.setAttribute('type', 'tel');
    expect(input.getDirectionality()).toBe('ltr');
    input.setAttribute('type', 'checkbox');
    expect(input.getDirectionality()).toBe('rtl');
    input.setAttribute('dir', 'auto');
    input.appendChild(document.createTextNode('א'));
    expect(input.getDirectionality()).toBe('rtl');
    input.setAttribute('dir', 'ltr');
    input.setAttribute('dir', 'auto');
    expect(input.getDirectionality()).toBe('rtl');
    input.firstChild!.textContent = 'A';
    expect(input.getDirectionality()).toBe('ltr');
    input.firstChild!.textContent = 'א';
    expect(input.getDirectionality()).toBe('rtl');
  });

  it('preserves element boundary overrides through the shared scan', () => {
    const document = parseTestDocument('<section dir=auto><span>א</span>A</section>');
    const root = document.querySelector('section')!;
    const child = document.querySelector('span')!;
    expect(root.getDirectionality()).toBe('rtl');
    const boundary = vi.spyOn(child, 'isAutoDirectionalityBoundary').mockReturnValue(true);
    try {
      expect(root.getDirectionality()).toBe('ltr');
      expect(boundary).toHaveBeenCalled();
    } finally { boundary.mockRestore(); }
  });

  it('defaults bdi to auto, and telephone inputs to ltr, independently of their parent', () => {
    const document = parseTestDocument('<div dir=rtl><bdi>123</bdi><input type=tel></div>');
    const bdi = document.querySelector('bdi')!;
    const input = document.querySelector('input')!;
    expect(bdi.getDirectionality()).toBe('ltr');
    bdi.textContent = 'א';
    expect(bdi.getDirectionality()).toBe('rtl');
    expect(input.getDirectionality()).toBe('ltr');
    input.setAttribute('dir', 'rtl');
    expect(input.getDirectionality()).toBe('rtl');
  });

  it.each(['open', 'closed'] as const)('uses the host and assigned nodes in a %s shadow root', (mode) => {
    const document = createTestDocument();
    const host = document.createElementNS(HTML_NAMESPACE, 'div');
    host.setAttribute('dir', 'rtl');
    const shadow = host.attachShadow({
      mode, delegatesFocus: false, slotAssignment: 'named', clonable: false, serializable: false,
    });
    const slot = document.createElementNS(HTML_NAMESPACE, 'slot');
    shadow.appendChild(slot);
    expect(slot.getDirectionality()).toBe('rtl');
    slot.setAttribute('dir', 'auto');
    slot.appendChild(document.createTextNode('א'));
    expect(slot.getDirectionality()).toBe('rtl');
    const text = document.createTextNode('A');
    host.appendChild(text);
    expect(slot.getDirectionality()).toBe('ltr'); // Assignments replace fallback text.
    text.data = 'א';
    expect(slot.getDirectionality()).toBe('rtl');
    text.remove();
    const assigned = document.createElementNS(HTML_NAMESPACE, 'span');
    assigned.textContent = 'א';
    assigned.setAttribute('dir', 'ltr');
    host.appendChild(assigned);
    expect(slot.getDirectionality()).toBe('ltr'); // The excluded root contributes no text.
    assigned.removeAttribute('dir');
    expect(slot.getDirectionality()).toBe('rtl');
    host.setAttribute('dir', 'ltr');
    expect(assigned.getDirectionality()).toBe('ltr'); // Assignment does not replace its ordinary parent.
    const container = document.createElementNS(HTML_NAMESPACE, 'section');
    container.setAttribute('dir', 'auto');
    shadow.appendChild(container);
    container.appendChild(slot);
    slot.removeAttribute('dir');
    expect(container.getDirectionality()).toBe('ltr'); // A contained slot contributes its host's direction.
  });

  it('includes CDATA text and returns null for text with no strong character', () => {
    const document = createTestDocument();
    const root = document.createElementNS(HTML_NAMESPACE, 'div');
    root.setAttribute('dir', 'auto');
    const text = document.createCDATASection('123');
    root.appendChild(text);
    expect(text.getDirectionality()).toBeNull();
    text.data = 'א';
    expect(text.getDirectionality()).toBe('rtl');
    expect(root.getDirectionality()).toBe('rtl');
  });

  it('keeps live control values explicit instead of substituting default attributes or child text', () => {
    const document = parseTestDocument('<input dir=auto value="א"><textarea dir=auto>א</textarea>');
    expect(() => document.querySelector('input')!.getDirectionality()).toThrow('Input current value is not implemented');
    expect(() => document.querySelector('textarea')!.getDirectionality()).toThrow('Textarea current value is not implemented');
  });

  it.each(['hidden', 'text', 'search', 'tel', 'url', 'email', 'password', 'submit', 'reset', 'button', 'textarea'])(
    'uses the current value for %s when its value dependency is supplied', (type) => {
      const document = createTestDocument();
      const control = document.createElementNS(HTML_NAMESPACE, type === 'textarea' ? type : 'input');
      assert(control instanceof HTMLInputElementImpl || control instanceof HTMLTextAreaElementImpl);
      control.setAttribute('type', type);
      control.setAttribute('dir', 'auto');
      // Control lifecycle is unfinished; supply just its current-value dependency for this algorithm.
      const value = vi.spyOn(control, 'value', 'get');
      for (const [text, direction] of [['', 'ltr'], ['123', 'ltr'], ['Aא', 'ltr'], ['אA', 'rtl']]) {
        value.mockReturnValue(text!);
        expect(control.getDirectionality()).toBe(direction);
      }
      value.mockRestore();
    },
  );

  it.each([
    ['div', 'title'], ['th', 'abbr'], ['area', 'alt'], ['img', 'alt'], ['input', 'alt'],
    ['input', 'placeholder'], ['textarea', 'placeholder'], ['optgroup', 'label'], ['option', 'label'], ['track', 'label'],
  ])('gives %s[%s] its own first-strong direction only under explicit auto', (tag, name) => {
    const document = createTestDocument();
    const element = document.createElementNS(HTML_NAMESPACE, tag);
    assert(element instanceof HTMLElementImpl);
    element.setAttribute('dir', 'auto');
    element.setAttribute(name, 'א');
    const attribute = element.getAttributeNode(name)!;
    expect(element.getAttributeDirectionality(attribute)).toBe('rtl');
    attribute.value = '123';
    expect(element.getAttributeDirectionality(attribute)).toBe('ltr');
    element.dir = 'rtl';
    expect(element.getAttributeDirectionality(attribute)).toBe('rtl');
  });

  it('does not confuse translatable attributes with directionality-capable attributes', () => {
    const document = createTestDocument();
    for (const [tag, name] of [['a', 'download'], ['div', 'lang'], ['div', 'style'], ['iframe', 'srcdoc'], ['td', 'abbr']]) {
      const element = document.createElementNS(HTML_NAMESPACE, tag!);
      assert(element instanceof HTMLElementImpl);
      element.dir = 'auto';
      element.setAttribute(name!, 'א');
      expect(element.getAttributeDirectionality(element.getAttributeNode(name!)!)).toBe('ltr');
    }
    const bdi = document.createElementNS(HTML_NAMESPACE, 'bdi');
    assert(bdi instanceof HTMLElementImpl);
    bdi.textContent = 'א';
    bdi.setAttribute('title', 'A');
    expect(bdi.getAttributeDirectionality(bdi.getAttributeNode('title')!)).toBe('rtl');
    bdi.dir = 'auto';
    expect(bdi.getAttributeDirectionality(bdi.getAttributeNode('title')!)).toBe('ltr');
    bdi.setAttributeNS('urn:other', 'other:title', 'A');
    expect(bdi.getAttributeDirectionality(bdi.getAttributeNodeNS('urn:other', 'title')!)).toBe('rtl');
  });

  it('keeps metadata-name classification explicit', () => {
    const document = parseTestDocument('<meta dir=auto name=description content="א">');
    const meta = document.querySelector('meta')!;
    assert(meta instanceof HTMLElementImpl);
    expect(() => meta.getAttributeDirectionality(meta.getAttributeNode('content')!))
      .toThrow('Metadata-name directionality rules are not implemented');
    meta.removeAttribute('name');
    expect(meta.getAttributeDirectionality(meta.getAttributeNode('content')!)).toBe('ltr');
  });

  it('forwards Document.dir only to an HTML html document element', () => {
    const document = createTestDocument();
    document.dir = 'rtl';
    expect(document.dir).toBe('');
    for (const [namespace, name] of [[HTML_NAMESPACE, 'div'], [SVG_NAMESPACE, 'html'], [HTML_NAMESPACE, 'html']]) {
      const root = document.createElementNS(namespace!, name!);
      document.appendChild(root);
      document.dir = 'RTL';
      const valid = namespace === HTML_NAMESPACE && name === 'html';
      expect(document.dir).toBe(valid ? 'rtl' : '');
      expect(root.getAttribute('dir')).toBe(valid ? 'RTL' : null);
      root.remove();
    }
  });

  it('exposes reflected strings and direction selectors through the platform bindings', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      document.dir = 'RTL';
      const element = document.createElement('div');
      document.body.append(element);
      const inherited = element.matches(':dir(rtl)');
      element.dir = 'AUTO';
      element.textContent = '١A';
      const result = [document.dir, document.documentElement.getAttribute('dir'), element.dir,
        element.getAttribute('dir'), inherited, element.matches(':dir(ltr)')];
      element.dir = 'invalid';
      return [...result, element.dir, element.matches(':dir(rtl)'), 'getDirectionality' in element];
    })).toEqual(['rtl', 'RTL', 'auto', 'AUTO', true, true, '', true, false]);
  });
});
