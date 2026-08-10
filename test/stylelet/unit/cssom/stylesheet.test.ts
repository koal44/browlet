import { describe, expect, it } from 'vitest';
import { SelectletCSSStyleSheet } from '../../../../src/stylelet/cssom/stylesheet';

describe('SelectletCSSStyleSheet', () => {
  it('owns a persistent media list', () => {
    const sheet = new SelectletCSSStyleSheet();

    sheet.media.mediaText = 'screen';

    expect(sheet.media.mediaText).toBe('screen');
    expect(sheet.media).toBe(sheet.media);
  });

  it('projects semantic property declarations into CSSOM declarations', () => {
    const sheet = new SelectletCSSStyleSheet(`
      .example {
        color: red;
        margin-top: 10px;
        --Brand: A/**/B;
      }
    `);

    const rule = sheet.cssRules.item(0) as CSSStyleRule;

    expect(rule.style.getPropertyValue('color')).toBe('red');
    expect(rule.style.getPropertyValue('margin-top')).toBe('10px');
    expect(rule.style.getPropertyValue('--Brand')).toBe('A/**/B');
    expect([...rule.style]).toEqual(['color', 'margin-top', '--Brand']);
  });

  it('selects the active declaration by source order and importance', () => {
    const sheet = new SelectletCSSStyleSheet(`
      .example {
        color: red !important;
        color: blue;
        color: green !important;
      }
    `);

    const rule = sheet.cssRules.item(0) as CSSStyleRule;

    expect(rule.style.getPropertyValue('color')).toBe('green');
    expect(rule.style.getPropertyPriority('color')).toBe('important');
    expect(rule.style.length).toBe(1);
  });
});
