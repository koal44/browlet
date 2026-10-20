import { browletDOM } from '../../../../src/browlet/integration/dom';
import { describe, expect, it } from 'vitest';

import { CSSStyleSheetImpl, type CSSStyleSheetInit } from '../../../../src/stylelet/cssom/css-stylesheet';
import { CSSRuleImpl } from '../../../../src/stylelet/cssom/rule';
import type { CSSStyleRuleImpl } from '../../../../src/stylelet/cssom/rules';
import { MediaListImpl } from '../../../../src/stylelet/cssom/media-list';
import { StyleSheetImpl } from '../../../../src/stylelet/cssom/stylesheet';
import { Stylelet, type InternalPromise } from '../../../../src/stylelet/index';
import { createBrowletDocument } from '../../browlet-document';

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
    expect(sheet.href).toBeNull();
    expect(sheet.baseURL?.href).toBe('https://example.com/css/');
    expect(sheet.ownerNode).toBeNull();
    expect(sheet.parentStyleSheet).toBeNull();
    expect(sheet.title).toBeNull();
    expect(sheet.media).not.toBe(media);
    expect(sheet.media.mediaText).toBe('screen');
    expect(sheet.disabled).toBe(true);

    sheet.disabled = false;
    sheet.media.mediaText = 'print';

    expect(sheet.disabled).toBe(false);
    expect(sheet.media.mediaText).toBe('print');
    expect(sheet.media).toBe(sheet.media);
  });

  it('creates a stylesheet from specified properties', () => {
    const document = createBrowletDocument();
    const stylelet = new Stylelet(document, { dom: browletDOM });
    const sheet = CSSStyleSheetImpl.create(stylelet.context, {
      location: new URL('https://example.com/style.css'),
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
    // Ordinary sheets must reach the import grammar; the constructed-sheet
    // prohibition must not hide this explicit missing implementation.
    expect(() => sheet.insertRule('@import "theme.css";')).toThrowError(
      '@import statement grammar and CSSOM construction are not implemented',
    );
  });

  it('resolves a relative constructor base through the standalone URL provider', () => {
    const sheet = createStyleSheet({ baseURL: '../css/' });

    expect(sheet.location).toBeNull();
    expect(sheet.baseURL).toBeInstanceOf(URL);
    expect(sheet.baseURL?.href).toBe('https://example.com/css/');
  });

  it('constructs style rules with parsed declarations', () => {
    const sheet = createStyleSheet();
    sheet.replaceSync(`
      .example {
        color: red;
        margin-top: 10px;
        --Brand: A/**/B;
      }
    `);

    const rule = sheet.cssRules.item(0) as CSSStyleRuleImpl;

    expect(rule).toBeInstanceOf(CSSRuleImpl);
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

    const rule = sheet.cssRules.item(0) as CSSStyleRuleImpl;

    expect(rule.style.getPropertyValue('color')).toBe('green');
    expect(rule.style.getPropertyPriority('color')).toBe('important');
    expect(rule.style.length).toBe(1);
  });

  it('mutates declarations through the CSSStyleDeclaration interface', () => {
    const sheet = createStyleSheet();
    sheet.replaceSync('.example { color: red; }');
    const style = (sheet.cssRules.item(0) as CSSStyleRuleImpl).style;

    style.setProperty('opacity', '50%', 'IMPORTANT');

    expect(style.getPropertyValue('opacity')).toBe('0.5');
    expect(style.getPropertyPriority('opacity')).toBe('important');
    expect(style.item(1)).toBe('opacity');
    expect(style.cssText).toBe('color: red; opacity: 0.5 !important;');

    expect(style.removeProperty('color')).toBe('red');
    expect(style.item(0)).toBe('opacity');
    expect(style.item(1)).toBe('');

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
    expect(rules.item(1)).toBe([...rules][1]);
  });

  it.each(['replaceSync', 'replace'] as const)('discards imports during %s', async (method) => {
    const sheet = createStyleSheet();
    const text = '@import "theme.css"; .kept { color: red }';

    if (method === 'replaceSync') sheet.replaceSync(text);
    else await observe(sheet.replace(text));

    expect(sheet.cssRules).toHaveLength(1);
    const rule = sheet.cssRules.item(0) as CSSStyleRuleImpl;
    expect(rule.style.getPropertyValue('color')).toBe('red');
  });

  it('preserves nested rules when the parent declarations change', () => {
    const sheet = createStyleSheet();
    sheet.replaceSync('.parent { color: red; .child { opacity: 0.5 } }');
    const parent = sheet.cssRules.item(0) as CSSStyleRuleImpl;

    parent.style.setProperty('color', 'blue');

    expect(parent.cssRules.length).toBe(1);
    const child = parent.cssRules.item(0) as CSSStyleRuleImpl;
    expect(child.style.getPropertyValue('opacity')).toBe('0.5');

    parent.style.cssText = 'margin-top: 1px';

    expect(parent.cssRules.item(0)).toBe(child);
    expect(child.style.getPropertyValue('opacity')).toBe('0.5');
  });

  it.each(['delete', 'replace'] as const)('detaches the nested rule tree on %s', (operation) => {
    const sheet = createStyleSheet();
    sheet.replaceSync('.parent { .child { color: red } opacity: 0.5 }');
    const parent = sheet.cssRules.item(0) as CSSStyleRuleImpl;
    const children = [...parent.cssRules];

    expect(parent.parentStyleSheet).toBe(sheet);
    for (const child of children) {
      expect(child.parentRule).toBe(parent);
      expect(child.parentStyleSheet).toBe(sheet);
    }

    if (operation === 'delete') sheet.deleteRule(0);
    else sheet.replaceSync('.replacement {}');

    expect(parent.parentStyleSheet).toBeNull();
    for (const child of children) {
      expect(child.parentRule).toBe(parent);
      expect(child.parentStyleSheet).toBeNull();
    }
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

  // SPEC_CLASH(sheet-insert-error-order): Follow the three browsers' index-first check.
  it('checks the insertion index before invalid rule syntax', () => {
    const sheet = createStyleSheet();

    expect(() => sheet.insertRule('not a rule', 1)).toThrowError(
      expect.objectContaining({ name: 'IndexSizeError' }),
    );
    expect(sheet.cssRules).toHaveLength(0);
  });

  it('replaces rules asynchronously while disallowing concurrent mutation', async () => {
    const sheet = createStyleSheet();
    const replacement = sheet.replace('.example {}');

    expect(() => sheet.insertRule('.other {}')).toThrowError(expect.objectContaining({ name: 'NotAllowedError' }));
    await expect(observe(replacement)).resolves.toBe(sheet);
    expect(sheet.cssRules).toHaveLength(1);
  });
});

function createStyleSheet(
  options: CSSStyleSheetInit = {},
): CSSStyleSheetImpl {
  const document = createBrowletDocument();
  Object.defineProperty(document, 'baseURI', {
    value: 'https://example.com/document/',
  });

  return new Stylelet(document, { dom: browletDOM }).createStyleSheet(options);
}

function observe<T>(value: InternalPromise<T>): Promise<T> {
  return new Promise((resolve, reject) => { value.observe(resolve, reject); });
}
