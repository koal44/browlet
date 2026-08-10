import { describe, expect, it } from 'vitest';
import {
  parseSelectorList, serializeSelectorList,
  type SelectorList, type SelectorSerializationContext,
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

  it('uses namespace mappings to omit semantically redundant prefixes', () => {
    const declaredNamespacePrefixes = new Set(['other', 'same']);
    const selector = parse(
      '*|div.foo, |*.bar, other|*.baz, same|*.qux',
      { declaredNamespacePrefixes },
    );
    const context: SelectorSerializationContext = {
      defaultNamespace: 'urn:default',
      namespacePrefixes: new Map([
        ['other', 'urn:other'],
        ['same', 'urn:default'],
      ]),
    };

    expect(serializeSelectorList(selector, context))
      .toBe('*|div.foo, |*.bar, other|*.baz, .qux');
  });

  it('treats an any-namespace prefix as redundant without a default namespace', () => {
    expect(serialize('*|div.foo, *|*.bar')).toBe('div.foo, .bar');
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
