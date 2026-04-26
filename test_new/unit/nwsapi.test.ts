import { describe, expect, it } from 'vitest';
import { parse, buildRex, DEFAULT_EXTENSIONS, DEFAULT_CONFIG, unescapeIdentifier } from '../../src/nwsapi';

describe('Rex', () => {
  const rex = buildRex(DEFAULT_EXTENSIONS);
  const testRe = (re: RegExp, value: string): boolean => {
    re.lastIndex = 0;
    return re.test(value);
  }

  it('should match valid identifiers', () => {
    expect(testRe(rex.STD.namespaces, 'test|p')).toBe(true);
    expect(testRe(rex.STD.namespaces, '*|p')).toBe(true);
    // expect(testRe(rex.STD.namespaces, '|p')).toBe(true);
    // expect(testRe(rex.STD.namespaces, 'test\\:p')).toBe(true);
  });
});

describe('unescapeIdentifier', () => {
  const rex = buildRex(DEFAULT_EXTENSIONS);
  it('should unescape valid identifiers', () => {
    expect(unescapeIdentifier('[data-nwsapi-scope] > *|item', rex)).toBe('[data-nwsapi-scope] > *|item');
  });
});

describe('parse namespace selectors', () => {
  const rex = buildRex(DEFAULT_EXTENSIONS);
  const config = { ...DEFAULT_CONFIG, VERBOSITY: false, LOGERRORS: false };

  it.each([
    'div',
    'div p',
    'div > p',
    '[data-nwsapi-scope] > p',
    // '*|p',
    // 'test|p',
    // '|p',
    // ':scope > *|item',
    // '[data-nwsapi-scope] > *|item',
    // '[data-nwsapi-scope] > |item',
  ])('accepts %s', (selector) => {
    // expect(parse(unescapeIdentifier(selector, rex), rex, config)).toEqual([selector]);
    expect(parse(selector, rex, config)).toEqual([selector]);
  });
});
