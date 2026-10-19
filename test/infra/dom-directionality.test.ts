import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';

import { getContainedTextDirection } from '../../src/infra/dom-directionality';
import { standardDOM } from '../../src/infra/dom-standard';
import { createOpaqueDOM } from '../support/opaque-dom';

describe('DOM directionality operations', () => {
  it('recognizes CDATA as Text when selecting descendant text', () => {
    const { window } = new JSDOM('<div xmlns="http://www.w3.org/1999/xhtml" dir="auto"><![CDATA[א]]></div>', {
      contentType: 'application/xhtml+xml',
    });
    try {
      const root = window.document.documentElement;
      expect(standardDOM.isText(root.firstChild!)).toBe(true);
      expect(standardDOM.getDirectionality(root)).toBe('rtl');
    } finally { window.close(); }
  });

  it('traverses opaque nodes and honors the host exclusion query', () => {
    const host = createOpaqueDOM('<section><span>א</span><!--א-->123A</section>');
    try {
      const root = host.opaque(host.window.document.querySelector('section')!);
      const excluded = host.opaque(host.window.document.querySelector('span')!);
      expect(getContainedTextDirection(root, false, host.dom)).toBe('rtl');
      const boundary = host.dom.isAutoDirectionalityBoundary.bind(host.dom);
      host.dom.isAutoDirectionalityBoundary = (element) => element === excluded || boundary(element);
      expect(getContainedTextDirection(root, false, host.dom)).toBe('ltr');
      expect(getContainedTextDirection(excluded, true, host.dom)).toBeNull();
      expect(getContainedTextDirection(excluded, false, host.dom)).toBe('rtl');
    } finally { host.close(); }
  });

  it('updates nontext input direction after child mutations and dir changes', () => {
    const { window } = new JSDOM('<input type="checkbox" dir="auto">');
    try {
      const input = window.document.querySelector('input')!;
      input.append('א');
      expect(standardDOM.getDirectionality(input)).toBe('rtl');
      input.dir = 'ltr';
      input.dir = 'auto';
      expect(standardDOM.getDirectionality(input)).toBe('rtl');
      input.firstChild!.textContent = 'A';
      expect(standardDOM.getDirectionality(input)).toBe('ltr');
      input.firstChild!.textContent = 'א';
      expect(standardDOM.getDirectionality(input)).toBe('rtl');
    } finally { window.close(); }
  });

  it('asks the host for a contained slot owner direction', () => {
    const host = createOpaqueDOM('<div></div>');
    try {
      const element = host.window.document.querySelector('div')!;
      const shadow = element.attachShadow({ mode: 'closed' });
      shadow.innerHTML = '<section><slot></slot>A</section>';
      const root = host.opaque(shadow.querySelector('section')!);
      const direction = vi.spyOn(host.dom, 'getDirectionality').mockReturnValue('rtl');
      expect(getContainedTextDirection(root, false, host.dom)).toBe('rtl');
      expect(direction).toHaveBeenCalledTimes(1);
      expect(direction.mock.calls[0]![0] === host.opaque(element)).toBe(true);
    } finally { host.close(); }
  });
});
