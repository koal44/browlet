import { describe, expect, it } from 'vitest';

import { Stylelet } from '../../../../src/stylelet/stylelet';
import { RawWholeValue } from '../../../../src/stylelet/values/whole-value';
import { OptionalDeclarationValue } from '../../../../src/stylelet/values/declaration-value';
import { createBrowletDocument } from '../../browlet-document';
import { createOpaqueDOM } from '../../../support/opaque-dom';

describe('computed custom properties', () => {
  it('inherits retained tokens, preserving case, escapes, and relative units', () => {
    const document = createBrowletDocument('<main><span></span></main>');
    const parent = document.querySelector('main')!;
    const child = document.querySelector('span')!;
    const styles = document.getStyleEngine();
    parent.setAttribute('style', String.raw`--Token: 01.00e+0EM/**/\72 ed; --token: lower`);

    expect(styles.getComputedStyle(child).getPropertyValue('--Token')).toBe(String.raw`01.00e+0EM/**/\72 ed`);
    expect(styles.getComputedStyle(child).getPropertyValue('--token')).toBe('lower');
    expect(styles.getComputedStyle(child).getPropertyValue('--TOKEN')).toBe('');
  });

  it('applies initial, inherit, and unset without inheriting declaration importance', () => {
    const document = createBrowletDocument('<main><span></span></main>');
    const parent = document.querySelector('main')!;
    const child = document.querySelector('span')!;
    parent.setAttribute('style', '--a: parent !important; --b: parent; --c: parent; --d: parent');
    child.setAttribute('style', '--a: child; --b: initial; --c: InHeRiT; --d: unset; --literal: initial extra');
    const computed = document.getStyleEngine().getComputedStyle(child);

    expect(['--a', '--b', '--c', '--d', '--literal'].map((name) => computed.getPropertyValue(name)))
      .toEqual(['child', '', 'parent', 'parent', 'initial extra']);
    expect(computed.getPropertyPriority('--c')).toBe('');
    expect(computed.computedStyle!.get('--b')).toBeUndefined();
  });

  it('keeps empty inherited values distinct from missing and initial values', () => {
    const document = createBrowletDocument('<main><span></span></main>');
    const parent = document.querySelector('main')!;
    const child = document.querySelector('span')!;
    parent.setAttribute('style', '--empty: ; --reset: something');
    child.setAttribute('style', '--reset: initial');
    const computed = document.getStyleEngine().getComputedStyle(child);

    expect(computed.getPropertyValue('--empty')).toBe(' ');
    expect(computed.computedStyle!.get('--empty')).toBeDefined();
    expect(computed.getPropertyValue('--missing')).toBe('');
    expect(computed.computedStyle!.get('--missing')).toBeUndefined();
    expect(computed.computedStyle!.get('--reset')).toBeUndefined();
    const declared = parent.getInlineStyleBlock()!.find('--empty')!.value.inner;
    const inherited = computed.computedStyle!.get('--empty')!.value.ordinaryValue();
    if (!(declared instanceof RawWholeValue) || !(inherited instanceof OptionalDeclarationValue)) throw new Error('Expected custom values');
    expect(inherited.repr).toBe(declared.repr.repr);
  });

  it('does not compute an overridden parent custom value or an unrelated parent built-in', () => {
    const document = createBrowletDocument('<main><span></span></main>');
    const parent = document.querySelector('main')!;
    const child = document.querySelector('span')!;
    parent.setAttribute('style', '--a: var(--missing); opacity: var(--missing)');
    child.setAttribute('style', '--a: child');

    expect(document.getStyleEngine().getComputedStyle(child).getPropertyValue('--a')).toBe('child');
  });

  it('uses guaranteed-invalid initial values when there is no inheritance parent', () => {
    const document = createBrowletDocument();
    const root = document.documentElement!;
    root.setAttribute('style', '--a: inherit; --b: unset; --c: initial');
    const computed = document.getStyleEngine().getComputedStyle(root);

    for (const name of ['--a', '--b', '--c']) {
      expect(computed.getPropertyValue(name)).toBe('');
      expect(computed.computedStyle!.get(name)).toBeUndefined();
    }
  });

  it('selects custom declarations by importance, specificity, and order before inheritance', () => {
    const document = createBrowletDocument('<main id="target"><span></span></main>');
    const parent = document.querySelector('main')!;
    const child = document.querySelector('span')!;
    const styles = document.getStyleEngine();
    const sheet = styles.createStyleSheet();
    sheet.replaceSync(`
      main { --a: first; --b: sheet !important }
      #target { --a: specific; --c: first }
      #target { --c: later }
    `);
    styles.documentScope.adoptedStyleSheets.push(sheet);
    parent.setAttribute('style', '--b: inline; --d: inline !important');
    const computed = styles.getComputedStyle(child);

    expect(['--a', '--b', '--c', '--d'].map((name) => computed.getPropertyValue(name)))
      .toEqual(['specific', 'sheet', 'later', 'inline']);
    expect(computed.getPropertyPriority('--b')).toBe('');
  });

  it('recomputes inherited values after mutations without changing older snapshots', () => {
    const document = createBrowletDocument('<main style="--a: before"><span></span></main>');
    const parent = document.querySelector('main')!;
    const child = document.querySelector('span')!;
    const styles = document.getStyleEngine();
    const before = styles.getComputedStyle(child);
    parent.setAttribute('style', '--a: after');

    expect(styles.getComputedStyle(child).getPropertyValue('--a')).toBe('after');
    expect(before.getPropertyValue('--a')).toBe('before');
  });

  it('respects an authoritative empty inline provider while inheriting through opaque nodes', () => {
    const host = createOpaqueDOM('<main style="--a: blocked"><span style="--a: blocked"></span></main>');
    try {
      const styles = new Stylelet(host.document, { dom: { ...host.dom, inlineStyleBlock: () => null } });
      const sheet = styles.createStyleSheet();
      sheet.replaceSync('main { --a: accepted }');
      styles.documentScope.adoptedStyleSheets.push(sheet);
      const child = host.opaque(host.window.document.querySelector('span')!);

      expect(styles.getComputedStyle(child).getPropertyValue('--a')).toBe('accepted');
    } finally { host.close(); }
  });

  it('substitutes custom properties before inheriting them, retaining token spelling and boundaries', () => {
    const document = createBrowletDocument('<main><span></span></main>');
    const parent = document.querySelector('main')!;
    const child = document.querySelector('span')!;
    parent.setAttribute('style', String.raw`--n: 01.00e+0; --unit: EM; --x: var(--n)var(--unit); --fn: calc(var(--n) * 1px); --word: foo\62 ar; --copy: var(--word)`);
    child.setAttribute('style', '--n: 20; --local: var(--n)');
    const computed = document.getStyleEngine().getComputedStyle(child);

    expect(['--x', '--fn', '--copy', '--local'].map((name) => computed.getPropertyValue(name)))
      .toEqual([String.raw`01.00e+0/**/EM`, 'calc(01.00e+0 * 1px)', String.raw`foo\62 ar`, '20']);
    expect(parent.getInlineStyleBlock()!.find('--x')!.serializeValue()).toBe('var(--n)var(--unit)');
  });

  it('keeps fallbacks lazy and distinguishes missing, invalid, and empty values', () => {
    const document = createBrowletDocument('<main></main>');
    const element = document.querySelector('main')!;
    element.setAttribute('style', '--a: value; --empty:; --b: var(--a, var(--b)); --c: var(--missing, one, two); --d: var(--empty, wrong); --e: var(--missing,); --f: var(--missing)');
    const computed = document.getStyleEngine().getComputedStyle(element);

    expect(['--b', '--c', '--d', '--e', '--f'].map((name) => computed.getPropertyValue(name)))
      .toEqual(['value', 'one, two', ' ', ' ', '']);
    expect(computed.computedStyle!.get('--f')).toBeUndefined();
  });

  it('invalidates every cycle participant while allowing an outside fallback', () => {
    const document = createBrowletDocument('<main></main>');
    const element = document.querySelector('main')!;
    element.setAttribute('style', '--a: var(--b, inside); --b: var(--c); --c: var(--a); --safe: var(--b, outside); --self: var(--self, wrong)');
    const computed = document.getStyleEngine().getComputedStyle(element);

    expect(['--a', '--b', '--c', '--safe', '--self'].map((name) => computed.getPropertyValue(name)))
      .toEqual(['', '', '', 'outside', '']);
  });

  it('finds later cycle edges after an earlier reference failed', () => {
    const document = createBrowletDocument('<main></main>');
    const element = document.querySelector('main')!;
    element.setAttribute('style', '--a: var(--missing) var(--b); --b: var(--a, wrong); --safe: var(--b, outside)');
    const computed = document.getStyleEngine().getComputedStyle(element);
    expect(['--a', '--b', '--safe'].map((name) => computed.getPropertyValue(name))).toEqual(['', '', 'outside']);
  });

  it('applies CSS-wide keywords produced by fallback and does not revive an earlier winner', () => {
    const document = createBrowletDocument('<main><span></span></main>');
    const parent = document.querySelector('main')!;
    const child = document.querySelector('span')!;
    parent.setAttribute('style', '--a: parent-a; --b: parent-b; --c: parent-c; --d: parent-d');
    child.setAttribute('style', '--a: var(--missing, inherit); --b: var(--missing, unset); --c: var(--missing, initial); --d: earlier; --d: var(--missing)');
    const computed = document.getStyleEngine().getComputedStyle(child);
    expect(['--a', '--b', '--c', '--d'].map((name) => computed.getPropertyValue(name)))
      .toEqual(['parent-a', 'parent-b', '', '']);
  });

  it('invalidates a cyclic fallback before interpreting its CSS-wide keyword', () => {
    const document = createBrowletDocument('<main><span></span></main>');
    const parent = document.querySelector('main')!;
    const child = document.querySelector('span')!;
    parent.setAttribute('style', '--a: attr(data-unused)');
    child.setAttribute('style', '--a: var(--a, inherit)');
    expect(document.getStyleEngine().getComputedStyle(child).getPropertyValue('--a')).toBe('');
  });

  it('bounds nested expansion before materializing an exponentially large value', () => {
    const document = createBrowletDocument('<main></main>');
    const element = document.querySelector('main')!;
    const declarations = ['--p0: a'];
    for (let i = 1; i <= 20; i++) declarations.push(`--p${i}: f(var(--p${i - 1}) var(--p${i - 1}))`);
    declarations.push('--safe: var(--p20, bounded)');
    element.setAttribute('style', declarations.join(';'));
    const computed = document.getStyleEngine().getComputedStyle(element);

    expect(computed.getPropertyValue('--p1')).toBe('f(a a)');
    expect(computed.getPropertyValue('--p20')).toBe('');
    expect(computed.getPropertyValue('--safe')).toBe('bounded');
  });
});
