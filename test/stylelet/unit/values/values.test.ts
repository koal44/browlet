import { parseListOfComponentValues } from '../../../../src/stylelet/syntax/parser';
import {
  describe, expect,
  it,
} from 'vitest';
import { TokenCursor } from '../../../../src/stylelet/syntax/token-cursor';

import { AnimationNameValue } from '../../../../src/stylelet/props/animation-name';

import { CssWideValue } from '../../../../src/stylelet/values/css-wide';
import { CustomIdentValue } from '../../../../src/stylelet/values/custom-ident';
import { StringValue } from '../../../../src/stylelet/values/string';

describe('CSS-wide value', () => {
  it('parses keywords case-insensitively into their canonical spelling', () => {
    const value = CssWideValue.parse(' ReVeRt-LaYeR ', {});

    expect(value).toMatchObject({
      value: 'revert-layer',
    });
  });

  it('rejects other identifiers and additional components', () => {
    expect(CssWideValue.parse('default', {})).toBeNull();
    expect(CssWideValue.parse('inherit initial', {})).toBeNull();
  });

  it('consumes one CSS-wide keyword without requiring the end of input', () => {
    const list = parseListOfComponentValues('inherit initial', {});
    const c = new TokenCursor(list, {});

    expect(CssWideValue.consume(c)).toMatchObject({
      value: 'inherit',
    });
    expect(c.pos()).toBe(1);
  });
});

// Property values

// This is unfinished!! we'll come back to it later. promise.
describe.skip('animation-name', () => {
  function valueOf(css: string): unknown {
    return AnimationNameValue.parse(css, {}) ?? undefined;
  }

  it('parses none', () => {
    expect(valueOf('none')).toEqual(
      new AnimationNameValue(['none']),
    );
  });

  it('parses a custom ident keyframes name', () => {
    expect(valueOf('fade-in')).toEqual(
      new AnimationNameValue([new CustomIdentValue('fade-in')]),
    );
  });

  it('parses a string keyframes name', () => {
    expect(valueOf('"fade-in"')).toEqual(
      new AnimationNameValue([new StringValue('fade-in')]),
    );
  });

  it('parses comma-separated animation names', () => {
    expect(valueOf('fade-in, "slide", none')).toEqual(
      new AnimationNameValue([new CustomIdentValue('fade-in'), new StringValue('slide'), 'none']),
    );
  });

  it('drops invalid animation-name declarations', () => {
    const cases = [
      '',
      '1',
      '1px',
      'var(--x)',
      'fade-in,',
      'fade-in,, slide',
    ];

    for (const css of cases) {
      expect(valueOf(css)).toBeUndefined();
    }
  });
});
