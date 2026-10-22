import { describe, expect, it } from 'vitest';

import { CSSDeclarationBlock } from '../../../../../src/stylelet/cssom/declarations/declaration-block';
import { InterpretedDeclaration } from '../../../../../src/stylelet/cssom/declarations/interpreted-declaration';
import { CSSStyleDeclarationImpl } from '../../../../../src/stylelet/cssom/declarations/style-declaration';
import { defaultStyleletEnvironment } from '../../../../../src/stylelet/environment';

describe('declaration collection', () => {
  it.each<[string, string, string]>([
    ['--x:/**/red/**/;', '/**/red/**/', ''],
    ['--x:/*only*/', '/*only*/', ''],
    ['--x: \t/*only*/ \n;', '/*only*/', ''],
    ['--x: /*before*/ red /*after*/ !/**/important /*priority*/;', '/*before*/ red /*after*/', 'important'],
    ['--x:/*only*/!important;', '/*only*/', 'important'],
    ['--x: \\  /*after*/;', '\\  /*after*/', ''],
  ])('retains custom-value comments while parsing %s', (input, expected, priority) => {
    const style = new CSSStyleDeclarationImpl({}, defaultStyleletEnvironment);
    style.cssText = input;
    expect(style.getPropertyValue('--x')).toBe(expected);
    expect(style.getPropertyPriority('--x')).toBe(priority);
  });

  it.each(['/**/red/**/', '/*only*/', '/*before*/ red /*after*/'])(
    'retains custom-value boundary comments through setters and cssText: %s', (value) => {
      const style = new CSSStyleDeclarationImpl({}, defaultStyleletEnvironment);
      style.setProperty('--x', value, 'important');
      expect(style.getPropertyValue('--x')).toBe(value);
      const text = style.cssText;
      style.cssText = text;
      expect(style.getPropertyValue('--x')).toBe(value);
      expect(style.getPropertyPriority('--x')).toBe('important');
      expect(style.cssText).toBe(text);
    },
  );

  it.each(['margin', 'margin-left', 'opacity'])('preserves deferred %s spelling through reads and edits', (name) => {
    const style = new CSSStyleDeclarationImpl({}, defaultStyleletEnvironment);
    const first = 'var( --gap ,  01.00px )';
    style.setProperty(name, first, 'important');
    expect(style.getPropertyValue(name)).toBe(first);
    expect(style.cssText).toBe(`${name}: ${first} !important;`);

    const second = 'var( --gap ,  001.0px )';
    style.setProperty(name, second, 'important');
    expect(style.getPropertyValue(name)).toBe(second);
    expect(style.cssText).toBe(`${name}: ${second} !important;`);
    const text = style.cssText;
    style.cssText = text;
    expect(style.getPropertyValue(name)).toBe(second);
  });

  it('keeps the winning important declaration and the order of unrelated edits', () => {
    const block = new CSSDeclarationBlock(InterpretedDeclaration.parseBlock(
      'color: red !important; opacity: .5; color: blue; margin-left: 1px; margin-top: 2px', {},
    ));
    expect(block.declarations.map(({ name }) => name)).toEqual(['color', 'opacity', 'margin-left', 'margin-top']);
    expect(block.set(InterpretedDeclaration.parseBlock('color: green', {})[0]!)).toBe(true);
    expect(block.set(InterpretedDeclaration.parseBlock('color: green', {})[0]!)).toBe(false);
    expect(block.cssText).toBe('color: green; opacity: 0.5; margin-left: 1px; margin-top: 2px;');
  });

  it('retains a block identity when declarations are replaced or cleared', () => {
    const block = new CSSDeclarationBlock();
    const style = new CSSStyleDeclarationImpl({ block }, defaultStyleletEnvironment);
    block.setText('--Name: /**/ A/**/B /**/; color: red', {});
    expect(style.getPropertyValue('--Name')).toBe('/**/ A/**/B /**/');
    style.cssText = 'opacity: .5';
    expect(block.cssText).toBe('opacity: 0.5;');
    block.clear();
    expect(style.length).toBe(0);
  });
});

describe('margin shorthand', () => {
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

  it.each<[string, string[], string]>([
    ['1px', ['1px', '1px', '1px', '1px'], '1px'],
    ['1px 2%', ['1px', '2%', '1px', '2%'], '1px 2%'],
    ['1px auto -3px', ['1px', 'auto', '-3px', 'auto'], '1px auto -3px'],
    ['1px 2px 3px 4px', ['1px', '2px', '3px', '4px'], '1px 2px 3px 4px'],
    ['1px 2px 3px 2px', ['1px', '2px', '3px', '2px'], '1px 2px 3px'],
    ['1px 2px 1px 2px', ['1px', '2px', '1px', '2px'], '1px 2px'],
    ['1px 1px 1px 1px', ['1px', '1px', '1px', '1px'], '1px'],
    ['0 AUTO', ['0px', 'auto', '0px', 'auto'], '0px auto'],
    [' 1px/**/2px ', ['1px', '2px', '1px', '2px'], '1px 2px'],
  ])('expands and shortens %s', (input, expected, text) => {
    const style = new CSSStyleDeclarationImpl({}, defaultStyleletEnvironment);
    style.setProperty('MARGIN', input, 'important');
    expect(['top', 'right', 'bottom', 'left'].map((side) => style.getPropertyValue(`margin-${side}`))).toEqual(expected);
    expect(style.length).toBe(4);
    expect(style.getPropertyValue('margin')).toBe(text);
    expect(style.getPropertyPriority('margin')).toBe('important');
    expect(style.cssText).toBe(`margin: ${text} !important;`);
    expect(style.removeProperty('margin')).toBe(text);
    expect(style.length).toBe(0);
  });

  it.each(['initial', 'inherit', 'unset', 'revert', 'revert-layer'])('expands the CSS-wide keyword %s', (keyword) => {
    const style = new CSSStyleDeclarationImpl({}, defaultStyleletEnvironment);
    style.cssText = `margin: ${keyword} !important`;
    expect(style.getPropertyValue('margin')).toBe(keyword);
    expect(style.getPropertyValue('margin-right')).toBe(keyword);
    expect(style.getPropertyPriority('margin-bottom')).toBe('important');
    expect(style.cssText).toBe(`margin: ${keyword} !important;`);
    style.setProperty('margin-left', '1px', 'important');
    expect(style.getPropertyValue('margin')).toBe('');
    expect(style.cssText).toContain(`margin-top: ${keyword} !important;`);
  });

  it.each([
    '1px 2px 3px 4px 5px', '1px, 2px', '1', '1unknown', 'initial 1px', '1px auto initial', '1px;', '1px !important', '{1px}',
  ])('rejects invalid input without partially changing the block: %s', (value) => {
    const style = new CSSStyleDeclarationImpl({}, defaultStyleletEnvironment);
    style.setProperty('margin', '2px', 'important');
    style.setProperty('margin', value);
    expect(style.cssText).toBe('margin: 2px !important;');
  });

  it('does not resolve contextual units or convert equivalent lengths while serializing', () => {
    const style = new CSSStyleDeclarationImpl({}, defaultStyleletEnvironment);
    style.cssText = 'margin: 1in 96px 2em 10%';
    expect(style.getPropertyValue('margin')).toBe('1in 96px 2em 10%');
    expect(style.cssText).toBe('margin: 1in 96px 2em 10%;');
    style.cssText = 'margin: calc(1px + 2px) auto';
    expect(style.getPropertyValue('margin')).toBe('calc(3px) auto');
  });

  it('cannot combine independently deferred longhands', () => {
    const style = new CSSStyleDeclarationImpl({}, defaultStyleletEnvironment);
    style.cssText = 'margin-top: var(--space); margin-right: var(--space); margin-bottom: var(--space); margin-left: var(--space)';
    expect(style.getPropertyValue('margin')).toBe('');
    expect(style.cssText).toBe('margin-top: var(--space); margin-right: var(--space); margin-bottom: var(--space); margin-left: var(--space);');
  });

  it.each([
    'var(--space)', 'calc(var(--space) + 1px)',
  ])('retains a pending shorthand for computed-time expansion: %s', (value) => {
    const style = new CSSStyleDeclarationImpl({}, defaultStyleletEnvironment);
    style.setProperty('margin', value);
    expect(style.getPropertyValue('margin')).toBe(value);
    expect(style.getPropertyValue('margin-left')).toBe('');
    expect(InterpretedDeclaration.parseBlock(`margin: ${value}`, {})).toHaveLength(4);
  });

  it('identifies the remaining first-valid shorthand dependency without changing declarations', () => {
    const style = new CSSStyleDeclarationImpl({}, defaultStyleletEnvironment);
    style.setProperty('margin', '1px');
    expect(() => style.setProperty('margin', 'first-valid(1px, 2px)')).toThrow('First-valid margin shorthand selection is not implemented');
    expect(() => InterpretedDeclaration.parseBlock('margin: first-valid(1px, 2px)', {})).toThrow('First-valid margin shorthand selection is not implemented');
    expect(style.cssText).toBe('margin: 1px;');
  });

  it('combines complete longhands with the same priority', () => {
    const style = new CSSStyleDeclarationImpl({}, defaultStyleletEnvironment);
    style.cssText = 'margin-top: 1px !important; margin-right: 2px !important; margin-bottom: 3px !important; margin-left: 4px !important';
    expect(style.getPropertyPriority('margin')).toBe('important');
    expect(style.getPropertyValue('margin')).toBe('1px 2px 3px 4px');
    expect(style.cssText).toBe('margin: 1px 2px 3px 4px !important;');
  });
});
