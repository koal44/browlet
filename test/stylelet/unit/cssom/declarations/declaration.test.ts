import { describe, expect, it } from 'vitest';

import { CSSDeclarationBlock, parseDeclarationBlock } from '../../../../../src/stylelet/cssom/declarations/declaration-block';
import { CSSStyleDeclarationImpl } from '../../../../../src/stylelet/cssom/declarations/declaration';
import { defaultStyleletEnvironment } from '../../../../../src/stylelet/environment';

describe('declaration collection', () => {
  it('keeps the winning important declaration and the order of unrelated edits', () => {
    const block = new CSSDeclarationBlock(parseDeclarationBlock(
      'color: red !important; opacity: .5; color: blue; margin-left: 1px; margin-top: 2px', {},
    ));
    expect(block.declarations.map(({ name }) => name)).toEqual(['color', 'opacity', 'margin-left', 'margin-top']);
    expect(block.set(parseDeclarationBlock('color: green', {})[0]!)).toBe(true);
    expect(block.set(parseDeclarationBlock('color: green', {})[0]!)).toBe(false);
    expect(block.cssText).toBe('color: green; opacity: 0.5; margin-left: 1px; margin-top: 2px;');
  });

  it('retains a block identity when declarations are replaced or cleared', () => {
    const block = new CSSDeclarationBlock();
    const style = new CSSStyleDeclarationImpl({ block }, defaultStyleletEnvironment);
    block.setText('--Name: /**/ A/**/B /**/; color: red', {});
    expect(style.getPropertyValue('--Name')).toBe('A/**/B');
    style.cssText = 'opacity: .5';
    expect(block.cssText).toBe('opacity: 0.5;');
    block.clear();
    expect(style.length).toBe(0);
  });
});

describe('shorthand dependency boundary', () => {
  it('queries and removes incomplete longhands without requiring value expansion or serialization', () => {
    const style = new CSSStyleDeclarationImpl({}, defaultStyleletEnvironment);
    style.cssText = 'color: red; margin-left: 1px !important; margin-top: 2px !important';
    expect(style.getPropertyValue('MARGIN')).toBe('');
    expect(style.getPropertyPriority('margin')).toBe('');
    expect(style.removeProperty('margin')).toBe('');
    expect(style.cssText).toBe('color: red;');
  });

  it('keeps mixed-priority longhands separate and removes them together', () => {
    const style = new CSSStyleDeclarationImpl({}, defaultStyleletEnvironment);
    style.cssText = 'margin-top: 1px; margin-right: 2px !important; margin-bottom: 3px; margin-left: 4px';
    expect(style.getPropertyValue('margin')).toBe('');
    expect(style.getPropertyPriority('margin')).toBe('');
    expect(style.cssText).toBe('margin-top: 1px; margin-right: 2px !important; margin-bottom: 3px; margin-left: 4px;');
    style.removeProperty('margin');
    expect(style.length).toBe(0);
  });

  // Expansion and serialization are explicitly deferred to the next property slice.
  // These checks locate the dependency; they are not shorthand conformance tests.
  it('reaches the unfinished expansion from both declaration text and CSSOM values', () => {
    const style = new CSSStyleDeclarationImpl({}, defaultStyleletEnvironment);
    expect(() => style.setProperty('margin', '1px')).toThrow('Margin shorthand expansion and pending substitution are not implemented');
    expect(() => style.setProperty('margin', 'var(--space)')).toThrow('Margin shorthand expansion and pending substitution are not implemented');
    expect(() => parseDeclarationBlock('margin: 1px', {})).toThrow('Margin shorthand expansion and pending substitution are not implemented');
  });

  it('can query complete priorities while value and block serialization reach the missing serializer', () => {
    const style = new CSSStyleDeclarationImpl({}, defaultStyleletEnvironment);
    style.cssText = 'margin-top: 1px !important; margin-right: 2px !important; margin-bottom: 3px !important; margin-left: 4px !important';
    expect(style.getPropertyPriority('margin')).toBe('important');
    expect(() => style.getPropertyValue('margin')).toThrow('Margin shorthand serialization is not implemented');
    expect(() => style.cssText).toThrow('Margin shorthand serialization is not implemented');
  });
});
