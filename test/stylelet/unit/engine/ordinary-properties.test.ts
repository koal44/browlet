import { describe, expect, it, vi } from 'vitest';

import { marginShorthand } from '../../../../src/stylelet/props/built-in/margin';
import { TokenList } from '../../../../src/stylelet/syntax/token-list';
import { WholeValue } from '../../../../src/stylelet/values/whole-value';
import { createBrowletDocument } from '../../browlet-document';

describe('computed ordinary properties', () => {
  it('reparses substituted tokens with the consuming property grammar', () => {
    const document = createBrowletDocument('<main></main>');
    const element = document.querySelector('main')!;
    element.setAttribute('style', '--alpha: 150%; --gap: 2px; opacity: var(--alpha); margin-left: calc(var(--gap) * 3); color: var(--missing, red)');
    const computed = document.getStyleEngine().getComputedStyle(element);

    expect(computed.getPropertyValue('opacity')).toBe('1');
    expect(computed.getPropertyValue('margin-left')).toBe('6px');
    expect(computed.getPropertyValue('color')).toBe('rgb(255, 0, 0)');
    expect(element.getInlineStyleBlock()!.find('opacity')!.serializeValue()).toBe('var(--alpha)');
  });

  it('defaults invalid winners without reviving earlier declarations', () => {
    const document = createBrowletDocument('<main style="color: blue; opacity: .25"><span></span></main>');
    const element = document.querySelector('span')!;
    element.setAttribute('style', '--empty:; --bad: 1px; --n: 2; color: red; color: var(--empty, green); opacity: .5; opacity: var(--bad, .75); margin-left: 8px; margin-left: var(--n)px');
    const computed = document.getStyleEngine().getComputedStyle(element);

    expect(computed.getPropertyValue('color')).toBe('rgb(0, 0, 255)');
    expect(computed.getPropertyValue('opacity')).toBe('1');
    expect(computed.getPropertyValue('margin-left')).toBe('0px');
  });

  it('applies missing and explicit defaults after substitution', () => {
    const document = createBrowletDocument('<main style="color: blue; opacity: .25; margin-left: 4px"><span></span></main>');
    const element = document.querySelector('span')!;
    element.setAttribute('style', 'color: var(--missing); opacity: var(--missing, inherit); margin-left: var(--missing, unset); margin-top: initial');
    const computed = document.getStyleEngine().getComputedStyle(element);

    expect(computed.getPropertyValue('color')).toBe('rgb(0, 0, 255)');
    expect(computed.getPropertyValue('opacity')).toBe('0.25');
    expect(computed.getPropertyValue('margin-left')).toBe('0px');
    expect(computed.getPropertyValue('margin-top')).toBe('0px');
    expect(computed.getPropertyValue('background-color')).toBe('rgba(0, 0, 0, 0)');
  });

  it('inherits computed values without reparsing against the child custom properties', () => {
    const document = createBrowletDocument('<main style="--alpha: 25%; opacity: var(--alpha) !important"><span style="--alpha: 75%; opacity: inherit"></span></main>');
    const element = document.querySelector('span')!;
    const computed = document.getStyleEngine().getComputedStyle(element);

    expect(computed.getPropertyValue('opacity')).toBe('0.25');
    expect(computed.getPropertyPriority('opacity')).toBe('');
    expect(computed.getPropertyValue('--alpha')).toBe('75%');
  });

  it('recomputes after custom-property changes while preserving earlier snapshots', () => {
    const document = createBrowletDocument('<main style="--alpha: 25%; opacity: var(--alpha)"></main>');
    const element = document.querySelector('main')!;
    const styles = document.getStyleEngine();
    const before = styles.getComputedStyle(element);
    element.setAttribute('style', '--alpha: 75%; opacity: var(--alpha)');

    expect(styles.getComputedStyle(element).getPropertyValue('opacity')).toBe('0.75');
    expect(before.getPropertyValue('opacity')).toBe('0.25');
  });

  it('does not substitute unused first-valid alternatives', () => {
    const document = createBrowletDocument('<main style="opacity: first-valid(.5, var(--missing))"></main>');
    const element = document.querySelector('main')!;
    expect(document.getStyleEngine().getComputedStyle(element).getPropertyValue('opacity')).toBe('0.5');
  });

  it('selects a custom whole value before substituting its consumers', () => {
    const document = createBrowletDocument('<main style="--gap: first-valid(2px, var(--gap)); margin-left: var(--gap)"></main>');
    const element = document.querySelector('main')!;
    const computed = document.getStyleEngine().getComputedStyle(element);

    expect(computed.getPropertyValue('--gap')).toBe('2px');
    expect(computed.getPropertyValue('margin-left')).toBe('2px');
    expect(element.getInlineStyleBlock()!.find('--gap')!.serializeValue()).toBe('first-valid(2px, var(--gap))');
  });

  it('does not retry first-valid alternatives after a selected var() fails computation', () => {
    const document = createBrowletDocument('<main style="opacity: first-valid(var(--missing), .5)"></main>');
    const element = document.querySelector('main')!;
    expect(document.getStyleEngine().getComputedStyle(element).getPropertyValue('opacity')).toBe('1');
  });

  it('expands a pending margin once per element and keeps overridden sides', () => {
    const document = createBrowletDocument('<main style="--space: 2px 4px; margin: var(--space); margin-left: 9px"></main>');
    const element = document.querySelector('main')!;
    // Parse the declared block before observing the computed-time expansion.
    element.getInlineStyleBlock();
    const expand = vi.spyOn(marginShorthand, 'expand');
    try {
      const computed = document.getStyleEngine().getComputedStyle(element);
      expect(computed.getPropertyValue('margin')).toBe('2px 4px 2px 9px');
      expect(expand).toHaveBeenCalledTimes(1);
      expect(element.getInlineStyleBlock()!.find('margin-top')!.serializeValue()).toBe('');
    } finally { expand.mockRestore(); }
  });

  it.each([
    'var(--missing)',
    'var(--missing,)',
    'var(--missing, 1px red)',
    'var(--missing, 1px 2px 3px 4px 5px)',
    'var(--missing, 2)px',
  ])('defaults only the surviving pending sides when expansion fails: %s', (value) => {
    const document = createBrowletDocument(`<main style="margin: 3px; margin: ${value}; margin-left: 9px"></main>`);
    const element = document.querySelector('main')!;
    element.getInlineStyleBlock();
    const expand = vi.spyOn(WholeValue.prototype, 'expandShorthand');
    try {
      expect(document.getStyleEngine().getComputedStyle(element).getPropertyValue('margin')).toBe('0px 0px 0px 9px');
      expect(expand).toHaveBeenCalledTimes(1);
    } finally { expand.mockRestore(); }
  });

  it('applies CSS-wide shorthand results to each longhand', () => {
    const document = createBrowletDocument('<main style="margin: 1px 2px 3px 4px"><span style="margin: var(--missing, inherit); margin-left: 9px"></span></main>');
    const element = document.querySelector('span')!;
    expect(document.getStyleEngine().getComputedStyle(element).getPropertyValue('margin')).toBe('1px 2px 3px 9px');
  });

  it('computes shared rule values separately for each element and query', () => {
    const document = createBrowletDocument('<main><i style="--space: 1px 2px"></i><b style="--space: 3px 4px"></b></main>');
    const styles = document.getStyleEngine();
    const sheet = styles.createStyleSheet();
    sheet.replaceSync('i, b { margin: var(--space) }');
    styles.documentScope.adoptedStyleSheets.push(sheet);
    const first = document.querySelector('i')!;
    const second = document.querySelector('b')!;
    const before = styles.getComputedStyle(first);

    expect(before.getPropertyValue('margin')).toBe('1px 2px');
    expect(styles.getComputedStyle(second).getPropertyValue('margin')).toBe('3px 4px');
    first.setAttribute('style', '--space: 5px');
    expect(styles.getComputedStyle(first).getPropertyValue('margin')).toBe('5px');
    expect(before.getPropertyValue('margin')).toBe('1px 2px');
  });

  it('keeps distinct pending shorthand occurrences separate on the same element', () => {
    const document = createBrowletDocument('<main style="--sheet: 1px 2px; --inline: 3px 4px; margin: var(--inline)"></main>');
    const element = document.querySelector('main')!;
    const styles = document.getStyleEngine();
    const sheet = styles.createStyleSheet();
    sheet.replaceSync('main { margin: var(--sheet) }');
    styles.documentScope.adoptedStyleSheets.push(sheet);
    const inline = element.getInlineStyleBlock()!;
    inline.remove('margin-top');
    inline.remove('margin-bottom');

    const expand = vi.spyOn(marginShorthand, 'expand');
    try {
      expect(styles.getComputedStyle(element).getPropertyValue('margin')).toBe('1px 4px');
      expect(expand).toHaveBeenCalledTimes(2);
    } finally { expand.mockRestore(); }
  });

  it('computes ordinary substitutions without requesting serialized source text', () => {
    const document = createBrowletDocument('<main style="--space: 1px 2px; margin: var(--space); opacity: var(--missing, .5)"></main>');
    const element = document.querySelector('main')!;
    element.getInlineStyleBlock();
    const sourceText = vi.spyOn(TokenList.prototype, 'sourceText');
    try {
      const computed = document.getStyleEngine().getComputedStyle(element);
      expect(sourceText).not.toHaveBeenCalled();
      expect(computed.getPropertyValue('margin')).toBe('1px 2px');
      expect(computed.getPropertyValue('opacity')).toBe('0.5');
    } finally { sourceText.mockRestore(); }
  });
});
