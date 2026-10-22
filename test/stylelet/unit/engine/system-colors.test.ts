import { describe, expect, it } from 'vitest';

import { Stylelet, absoluteColorFromRgba, createSystemColorPalette } from '../../../../src/stylelet/index';
import { createOpaqueDOM } from '../../../support/opaque-dom';

describe('host-supplied system colors', () => {
  it('supplies the default palette to initial values without a selected declaration', () => {
    const host = createOpaqueDOM('<main></main>');
    try {
      const styles = new Stylelet(host.document, { dom: host.dom });
      const element = host.opaque(host.window.document.querySelector('main')!);
      expect(styles.getComputedStyle(element).getPropertyValue('color')).toBe('rgb(0, 0, 0)');
      expect(host.dom.getAttributeNS(element, null, 'style')).toBeNull();
    } finally { host.close(); }
  });

  it('uses supplied colors for defaulting, substitution, and deprecated system names', () => {
    const host = createOpaqueDOM('<main style="--ink: WindowText; background-color: Highlight"><span style="color: var(--ink)"></span></main>');
    try {
      const systemColors = createSystemColorPalette({
        canvastext: absoluteColorFromRgba(0x123456ff),
        highlight: absoluteColorFromRgba(0xabcdefff),
      });
      const styles = new Stylelet(host.document, { dom: host.dom, systemColors });
      const parent = host.opaque(host.window.document.querySelector('main')!);
      const child = host.opaque(host.window.document.querySelector('span')!);
      const computed = styles.getComputedStyle(parent);
      expect(computed.getPropertyValue('color')).toBe('rgb(18, 52, 86)');
      expect(computed.getPropertyValue('background-color')).toBe('rgb(171, 205, 239)');
      expect(styles.getComputedStyle(child).getPropertyValue('color')).toBe('rgb(18, 52, 86)');
      expect(styles.getComputedStyle(child).getPropertyValue('--ink')).toBe('WindowText');

      systemColors.set('canvastext', absoluteColorFromRgba(0x654321ff));
      expect(styles.getComputedStyle(child).getPropertyValue('color')).toBe('rgb(101, 67, 33)');
      expect(computed.getPropertyValue('color')).toBe('rgb(18, 52, 86)');
    } finally { host.close(); }
  });

  it('keeps host palettes independent and leaves declared system colors unchanged', () => {
    const host = createOpaqueDOM('<main style="color: CanvasText"></main>');
    try {
      const systemColors = createSystemColorPalette({ canvastext: absoluteColorFromRgba(0xff0000ff) });
      const first = new Stylelet(host.document, { dom: host.dom, systemColors });
      const second = new Stylelet(host.document, { dom: host.dom });
      const element = host.opaque(host.window.document.querySelector('main')!);
      expect(first.getComputedStyle(element).getPropertyValue('color')).toBe('rgb(255, 0, 0)');
      expect(second.getComputedStyle(element).getPropertyValue('color')).toBe('rgb(0, 0, 0)');
      expect(host.dom.getAttributeNS(element, null, 'style')).toBe('color: CanvasText');
    } finally { host.close(); }
  });
});
