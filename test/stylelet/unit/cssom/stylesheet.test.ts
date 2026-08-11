import { describe, expect, it } from 'vitest';

import { CSSStyleSheetImpl } from '../../../../src/stylelet/cssom/css-stylesheet';
import { MediaListImpl } from '../../../../src/stylelet/cssom/media-list';
import { StyleSheetImpl } from '../../../../src/stylelet/cssom/stylesheet';
import { createStylelet } from '../../../../src/stylelet/stylelet';
import { createDomletDocument } from '../selector/domlet';

describe('StyleSheetImpl', () => {
  it('is an exposed prototype but not a directly constructible interface', () => {
    expect(() => {
      Reflect.construct(StyleSheetImpl, []);
    })
      .toThrowError(new TypeError('Illegal constructor'));
  });
});

describe('CSSStyleSheetImpl', () => {
  it('initializes the StyleSheet state from its constructor options', () => {
    const media = new MediaListImpl('screen');
    const sheet = createStyleSheet({
      baseURL: 'https://example.com/css/',
      media,
      disabled: true,
    });

    expect(sheet.type).toBe('text/css');
    expect(sheet).toBeInstanceOf(CSSStyleSheetImpl);
    expect(sheet).toBeInstanceOf(StyleSheetImpl);
    expect(sheet.href).toBe('https://example.com/document/');
    expect(sheet.ownerNode).toBeNull();
    expect(sheet.parentStyleSheet).toBeNull();
    expect(sheet.title).toBeNull();
    expect(sheet.media).not.toBe(media);
    expect(sheet.media.mediaText).toBe('screen');
    expect(sheet.disabled).toBe(true);

    sheet.disabled = false;
    sheet.media = 'print';

    expect(sheet.disabled).toBe(false);
    expect(sheet.media.mediaText).toBe('print');
    expect(sheet.media).toBe(sheet.media);
  });

  it('creates a stylesheet from specified properties', () => {
    const document = createDomletDocument('');
    const stylelet = createStylelet(document);
    const sheet = CSSStyleSheetImpl.__create(stylelet.snapshot, {
      location: 'https://example.com/style.css',
      parentStyleSheet: null,
      ownerNode: null,
      ownerRule: null,
      media: 'print',
      title: 'alternate',
      alternate: true,
      originClean: true,
    });

    expect(sheet.href).toBe('https://example.com/style.css');
    expect(sheet.parentStyleSheet).toBeNull();
    expect(sheet.ownerNode).toBeNull();
    expect(sheet.ownerRule).toBeNull();
    expect(sheet.media.mediaText).toBe('print');
    expect(sheet.title).toBe('alternate');
    expect(() => sheet.replaceSync('body {}')).toThrowError(
      expect.objectContaining({ name: 'NotAllowedError' }),
    );
  });

  it('projects semantic property declarations into CSSOM declarations', () => {
    const sheet = createStyleSheet();
    sheet.replaceSync(`
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
    expect(rule.style.parentRule).toBe(rule);
    expect(rule.style.cssText)
      .toBe('color: red; margin-top: 10px; --Brand: A/**/B;');
  });

  it('selects the active declaration by source order and importance', () => {
    const sheet = createStyleSheet();
    sheet.replaceSync(`
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

  it('mutates declarations through the CSSStyleDeclaration interface', () => {
    const sheet = createStyleSheet();
    sheet.replaceSync('.example { color: red; }');
    const style = (sheet.cssRules.item(0) as CSSStyleRule).style;

    style.setProperty('opacity', '50%', 'IMPORTANT');

    expect(style.opacity).toBe('0.5');
    expect(style.getPropertyPriority('opacity')).toBe('important');
    expect(style[1]).toBe('opacity');
    expect(style.cssText).toBe('color: red; opacity: 0.5 !important;');

    expect(style.removeProperty('color')).toBe('red');
    expect(style[0]).toBe('opacity');
    expect(style[1]).toBeUndefined();

    style.cssText = 'margin-top: 1px; color: blue';

    expect([...style]).toEqual(['margin-top', 'color']);
    expect(style.cssText).toBe('margin-top: 1px; color: blue;');
  });

  it('keeps its live CSSRuleList object while replacing rules', () => {
    const sheet = createStyleSheet();
    const rules = sheet.cssRules;

    sheet.replaceSync('.first {}');

    expect(sheet.cssRules).toBe(rules);
    expect(rules).toHaveLength(1);

    sheet.replaceSync('.first {} .second {}');

    expect(sheet.cssRules).toBe(rules);
    expect(rules).toHaveLength(2);
    expect(rules.item(1)).toBe(rules[1]);
  });

  it('inserts and deletes rules through the live rule list', () => {
    const sheet = createStyleSheet();
    const rules = sheet.cssRules;

    expect(sheet.insertRule('.second {}')).toBe(0);
    expect(sheet.insertRule('.first {}', 0)).toBe(0);
    expect(rules).toHaveLength(2);

    sheet.deleteRule(0);

    expect(rules).toHaveLength(1);
    expect(() => sheet.deleteRule(1)).toThrowError(expect.objectContaining({
      name: 'IndexSizeError',
    }));
    expect(() => sheet.insertRule('.third {}', 2)).toThrowError(
      expect.objectContaining({ name: 'IndexSizeError' }),
    );
    expect(() => sheet.insertRule('@import "theme.css";')).toThrowError(
      expect.objectContaining({ name: 'SyntaxError' }),
    );
  });

  it('supports the legacy rule aliases', () => {
    const sheet = createStyleSheet();

    expect(sheet.rules).toBe(sheet.cssRules);
    expect(sheet.addRule('.legacy', 'color: red')).toBe(-1);
    expect(sheet.cssRules).toHaveLength(1);

    sheet.removeRule();

    expect(sheet.cssRules).toHaveLength(0);
  });

  it('replaces rules asynchronously while disallowing concurrent mutation', async () => {
    const sheet = createStyleSheet();
    const replacement = sheet.replace('.example {}');

    expect(() => sheet.insertRule('.other {}')).toThrowError(DOMException);
    await expect(replacement).resolves.toBe(sheet);
    expect(sheet.cssRules).toHaveLength(1);
  });
});

function createStyleSheet(
  options: CSSStyleSheetInit = {},
): CSSStyleSheet {
  const document = createDomletDocument('');
  Object.defineProperty(document, 'baseURI', {
    value: 'https://example.com/document/',
  });

  return createStylelet(document).createStyleSheet(options);
}
