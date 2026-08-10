import { describe, expect, it } from 'vitest';
import {
  parseSelectorList, serializeSelectorList,
  type SelectorList,
} from '../../../../src/stylelet/syntax/selector';

describe('selector serialization', () => {
  it.each([
    ['main.foo#target[data-x=bar I]>a+b~c', 'main.foo#target[data-x="bar" i] > a + b ~ c'],
    ['*', '*'],
    ['*.foo', '.foo'],
    [':before', '::before'],
    ['::before::marker', '::before::marker'],
    [String.raw`.\31 foo, #\@`, String.raw`.\31 foo, #\@`],
  ])('serializes %s canonically', (input, expected) => {
    expect(serialize(input)).toBe(expected);
  });

  it.each([
    [':is(.a, :bogus, .b)', ':is(.a, .b)'],
    [':not(.a>.b,#target)', ':not(.a > .b, #target)'],
    [':has(>.a,+#target)', ':has(> .a, + #target)'],
    [':nth-child(odd of .a>.b,#target)', ':nth-child(2n+1 of .a > .b, #target)'],
    [':lang(EN, "fr"):dir(SIDEWAYS)', ':lang("EN", "fr"):dir(SIDEWAYS)'],
    [String.raw`:lang(\*-Latn, "")`, ':lang("*-Latn", "")'],
    [':local-link(+02)', ':local-link(2)'],
    [':nth-of-type(EVEN)', ':nth-of-type(2n)'],
    [':current(.a, #target)', ':current(.a, #target)'],
    [':host(.shell)', ':host(.shell)'],
    [':heading(1, 2, -1)', ':heading(1, 2, -1)'],
    [
      '::highlight(Foo), ::part(foo active), ::slotted(.item#target)',
      '::highlight(Foo), ::part(foo active), ::slotted(.item#target)',
    ],
  ])('serializes modern functional syntax in %s', (input, expected) => {
    expect(serialize(input)).toBe(expected);
  });

  it.each([
    ':lang("EN", "fr")',
    ':lang("*-Latn", "")',
    ':dir(RTL), :dir(SideWays)',
  ])('is idempotent after serializing %s once', (input) => {
    const serialized = serialize(input);
    expect(serialize(serialized)).toBe(serialized);
  });

  it('uses the parser namespace context to omit redundant prefixes', () => {
    const selector = parse(
      '*|div.foo, |*.bar, other|*.baz, same|*.qux',
      {
        namespacePrefixes: new Map([
          ['other', 'urn:other'],
          ['same', 'urn:default'],
        ]),
        defaultNamespace: 'urn:default',
      },
    );

    expect(serializeSelectorList(selector))
      .toBe('*|div.foo, |*.bar, other|*.baz, .qux');
  });

  it('treats an any-namespace prefix as redundant without a default namespace', () => {
    expect(serialize('*|div.foo, *|*.bar')).toBe('div.foo, .bar');
  });

  it('retains an any-namespace prefix when a default namespace exists', () => {
    const context = { defaultNamespace: 'urn:default' };
    expect(serializeSelectorList(parse('*|div.foo, *|*.bar', context)))
      .toBe('*|div.foo, *|*.bar');
  });

  it('normalizes the empty attribute namespace without applying the default', () => {
    const context = {
      namespacePrefixes: new Map([['same', 'urn:default']]),
      defaultNamespace: 'urn:default',
    };
    expect(serializeSelectorList(parse('[|href], [same|href]', context)))
      .toBe('[href], [same|href]');
  });

  it('normalizes default namespace aliases inside selector arguments', () => {
    const context = {
      namespacePrefixes: new Map([
        ['other', 'urn:other'],
        ['same', 'urn:default'],
      ]),
      defaultNamespace: 'urn:default',
    };
    expect(serializeSelectorList(parse(':is(same|div, other|div)', context)))
      .toBe(':is(div, other|div)');
  });

  it('normalizes prefixes bound to the null namespace', () => {
    const context = {
      namespacePrefixes: new Map([['empty', '']]),
    };
    expect(serializeSelectorList(parse('empty|div, [empty|href]', context)))
      .toBe('|div, [href]');
  });
});

function serialize(input: string): string {
  return serializeSelectorList(parse(input));
}

function parse(
  input: string,
  context: Parameters<typeof parseSelectorList>[1] = {},
): SelectorList {
  const selector = parseSelectorList(input, context);
  expect(selector, `Expected selector to parse: ${input}`).not.toBeNull();
  return selector!;
}
