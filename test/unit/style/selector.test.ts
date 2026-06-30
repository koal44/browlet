import { describe, expect, it } from 'vitest';
import { ComponentCursor } from '../../../src/stylelet/parser/component-cursor';
import { type ComplexSelector, type ComplexSelectorList, SelectorKind, tryParseSelectorList } from '../../../src/stylelet/parser/selector';
import { consumeComponentTrivia, parseListOfComponentValues } from '../../../src/stylelet/parser/syntax';
import { PseudoClassArgumentKind, PseudoElementArgumentKind } from '../../../src/stylelet/parser/selector-pseudo';

const cursor = (css: string): ComponentCursor =>
  new ComponentCursor(parseListOfComponentValues(css));

function parseFull(css: string): ComplexSelectorList | null {
  const c = cursor(css);
  const result = tryParseSelectorList(c);

  if (result === null) {
    return null;
  }

  consumeComponentTrivia(c);

  if (c.peek() !== null) {
    return null;
  }

  return result;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
function rethrowFromCaller(error: unknown, caller: Function): never {
  if (error instanceof Error) {
    Error.captureStackTrace(error, caller);
  }

  throw error;
}

function expectComplexSelectorList(css: string): ComplexSelectorList {
  try {
    const result = parseFull(css);

    expect(result, `Expected selector list to parse: ${css}`).not.toBeNull();

    return result!;
  } catch (error) {
    rethrowFromCaller(error, expectComplexSelectorList);
  }
}

function expectComplexSelector(css: string): ComplexSelector {
  try {
    const result = expectComplexSelectorList(css);

    expect(result.arms, `Expected exactly one selector for: ${css}`).toHaveLength(1);

    return result.arms[0];
  } catch (error) {
    rethrowFromCaller(error, expectComplexSelector);
  }
}

function expectInvalidSelector(css: string): void {
  try {
    const result = parseFull(css);

    expect(result, `Expected selector to be invalid: ${css}`).toBeNull();
  } catch (error) {
    rethrowFromCaller(error, expectInvalidSelector);
  }
}

// =============================================================================
// Expected selector AST builders
// =============================================================================

type TestCombinator = string | null;

const ns = (prefix: string | null) => ({
  prefix,
});

const typeSelector = (name: string, namespace: unknown = null) => ({
  name,
  namespace,
});

const idSelector = (name: string) => ({
  kind: SelectorKind.IdSelector,
  name,
});

const classSelector = (name: string) => ({
  kind: SelectorKind.ClassSelector,
  name,
});

const attrName = (name: string, namespace: unknown = null) => ({
  name,
  namespace,
});

const attrSelector = (name: string, rest: object = {}) => ({
  kind: SelectorKind.AttributeSelector,
  name: attrName(name),
  ...rest,
});

const compound = (typeSelectorValue: unknown = null, subclasses: unknown[] = []) => ({
  typeSelector: typeSelectorValue,
  subclasses,
});

const unit = (compoundValue: unknown = null, pseudoCompounds: unknown[] = []) => ({
  compound: compoundValue,
  pseudoCompounds,
});

const part = (combinator: TestCombinator, compoundValue: unknown = null, pseudoCompounds: unknown[] = []) => ({
  combinator,
  unit: unit(compoundValue, pseudoCompounds),
});

const typePart = (combinator: TestCombinator, name: string, namespace: unknown = null) => part(
  combinator,
  compound(typeSelector(name, namespace)),
);

const idPart = (combinator: TestCombinator, name: string) => part(
  combinator,
  compound(null, [idSelector(name)]),
);

const classPart = (combinator: TestCombinator, name: string) => part(
  combinator,
  compound(null, [classSelector(name)]),
);

const attrPart = (combinator: TestCombinator, name: string, rest: object = {}) => part(
  combinator,
  compound(null, [attrSelector(name, rest)]),
);

const identValue = (value: string) => ({
  type: 'ident',
  value,
});

const stringValue = (value: string) => ({
  type: 'string',
  value,
});

const pseudoClass = (name: string, rest: object = {}) => ({
  kind: SelectorKind.PseudoClassSelector,
  name,
  ...rest,
});

const pseudoClassPart = (name: string, rest: object = {}) => part(
  null,
  compound(null, [
    pseudoClass(name, rest),
  ]),
);

const pseudoArgument = (kind: PseudoClassArgumentKind, rest: object = {}) => ({
  kind,
  ...rest,
});

const pseudoElement = (name: string, rest: object = {}) => ({
  kind: SelectorKind.PseudoElementSelector,
  name,
  ...rest,
});

const pseudoCompound = (name: string, rest: object = {}, pseudoClasses: unknown[] = []) => ({
  kind: SelectorKind.PseudoCompoundSelector,
  pseudoElement: pseudoElement(name, rest),
  pseudoClasses,
});

const pseudoElementPart = (name: string, rest: object = {}, pseudoClasses: unknown[] = []) => part(
  null,
  null,
  [
    pseudoCompound(name, rest, pseudoClasses),
  ],
);

const pseudoElementArgument = (kind: PseudoElementArgumentKind, rest: object = {}) => ({
  kind,
  ...rest,
});

const selectorList = (arms: unknown[]) => ({
  arms,
});

describe('selector parser basics', () => {
  it('rejects an empty selector list', () => {
    expectInvalidSelector('');
  });

  it('parses a type selector', () => {
    expect(expectComplexSelector('div')).toMatchObject({
      kind: SelectorKind.ComplexSelector,
      parts: [
        typePart(null, 'div'),
      ],
    });
  });

  it('parses a universal selector', () => {
    expect(expectComplexSelector('*')).toMatchObject({
      parts: [
        typePart(null, '*'),
      ],
    });
  });

  it('parses an id selector', () => {
    expect(expectComplexSelector('#foo')).toMatchObject({
      parts: [
        idPart(null, 'foo'),
      ],
    });
  });

  it('parses a class selector', () => {
    expect(expectComplexSelector('.foo')).toMatchObject({
      parts: [
        classPart(null, 'foo'),
      ],
    });
  });

  it('parses a compound selector with type, id, and class selectors', () => {
    expect(expectComplexSelector('div#main.foo.bar')).toMatchObject({
      parts: [
        part(
          null,
          compound(
            typeSelector('div'),
            [
              idSelector('main'),
              classSelector('foo'),
              classSelector('bar'),
            ],
          ),
        ),
      ],
    });
  });

  it('rejects a bare class delimiter', () => {
    expectInvalidSelector('.');
  });

  it('rejects whitespace between class delimiter and ident', () => {
    expectInvalidSelector('. foo');
  });

  it('rejects a bare id hash without an identifier hash token', () => {
    expectInvalidSelector('#');
  });
});

describe('selector parser namespace and type selectors', () => {
  it('parses a namespace-qualified type selector', () => {
    expect(expectComplexSelector('svg|circle')).toMatchObject({
      parts: [
        typePart(null, 'circle', ns('svg')),
      ],
    });
  });

  it('parses an empty namespace prefix', () => {
    expect(expectComplexSelector('|circle')).toMatchObject({
      parts: [
        typePart(null, 'circle', ns(null)),
      ],
    });
  });

  it('parses a wildcard namespace prefix', () => {
    expect(expectComplexSelector('*|circle')).toMatchObject({
      parts: [
        typePart(null, 'circle', ns('*')),
      ],
    });
  });

  it('parses a namespace-qualified universal selector', () => {
    expect(expectComplexSelector('svg|*')).toMatchObject({
      parts: [
        typePart(null, '*', ns('svg')),
      ],
    });
  });

  it('parses a wildcard namespace universal selector', () => {
    expect(expectComplexSelector('*|*')).toMatchObject({
      parts: [
        typePart(null, '*', ns('*')),
      ],
    });
  });

  it('rejects a dangling namespace separator', () => {
    expectInvalidSelector('svg|');
  });
});

describe('selector parser attribute selectors', () => {
  it('parses an existence attribute selector', () => {
    expect(expectComplexSelector('[href]')).toMatchObject({
      parts: [
        attrPart(null, 'href'),
      ],
    });
  });

  it('parses an exact-match attribute selector with ident value', () => {
    expect(expectComplexSelector('[href=example]')).toMatchObject({
      parts: [
        attrPart(null, 'href', {
          matcher: '=',
          value: {
            type: 'ident',
            value: 'example',
          },
        }),
      ],
    });
  });

  it('parses an exact-match attribute selector with string value', () => {
    expect(expectComplexSelector('[href="example"]')).toMatchObject({
      parts: [
        attrPart(null, 'href', {
          matcher: '=',
          value: stringValue('example'),
        }),
      ],
    });
  });

  it('parses attribute selector whitespace around components', () => {
    expect(expectComplexSelector('[ href = example ]')).toMatchObject({
      parts: [
        attrPart(null, 'href', {
          matcher: '=',
          value: identValue('example'),
        }),
      ],
    });
  });

  it('parses all attribute matcher prefixes', () => {
    for (const matcher of ['~=', '|=', '^=', '$=', '*='] as const) {
      expect(expectComplexSelector(`[a${matcher}b]`), matcher).toMatchObject({
        parts: [
          attrPart(null, 'a', {
            matcher,
          }),
        ],
      });
    }
  });

  it('parses an ASCII case-insensitive attribute modifier', () => {
    expect(expectComplexSelector('[href=example i]')).toMatchObject({
      parts: [
        attrPart(null, 'href', {
          matcher: '=',
          value: identValue('example'),
          modifier: 'i',
        }),
      ],
    });
  });

  it('parses an ASCII case-sensitive attribute modifier', () => {
    expect(expectComplexSelector('[href=example s]')).toMatchObject({
      parts: [
        attrPart(null, 'href', {
          matcher: '=',
          value: identValue('example'),
          modifier: 's',
        }),
      ],
    });
  });

  it('parses a namespaced attribute name', () => {
    expect(expectComplexSelector('[svg|href=value]')).toMatchObject({
      parts: [
        attrPart(null, 'href', {
          name: attrName('href', ns('svg')),
          matcher: '=',
        }),
      ],
    });
  });

  it('rejects an empty attribute selector', () => {
    expectInvalidSelector('[]');
  });

  it('rejects an attribute selector missing a value after matcher', () => {
    expectInvalidSelector('[href=]');
  });

  it('rejects an attribute matcher split by whitespace', () => {
    expectInvalidSelector('[href ~ = value]');
  });

  it('rejects an unsupported attribute modifier', () => {
    expectInvalidSelector('[href=value q]');
  });

  it('rejects trailing garbage inside an attribute selector', () => {
    expectInvalidSelector('[href value]');
  });
});

describe('selector parser combinators', () => {
  it('parses a descendant combinator', () => {
    expect(expectComplexSelector('div span')).toMatchObject({
      parts: [
        typePart(null, 'div'),
        typePart(' ', 'span'),
      ],
    });
  });

  it('parses a child combinator with whitespace', () => {
    expect(expectComplexSelector('div > span')).toMatchObject({
      parts: [
        typePart(null, 'div'),
        typePart('>', 'span'),
      ],
    });
  });

  it('parses a child combinator without whitespace', () => {
    expect(expectComplexSelector('div>span')).toMatchObject({
      parts: [
        typePart(null, 'div'),
        typePart('>', 'span'),
      ],
    });
  });

  it('parses adjacent and subsequent sibling combinators', () => {
    expect(expectComplexSelector('h1 + p')).toMatchObject({
      parts: [
        typePart(null, 'h1'),
        typePart('+', 'p'),
      ],
    });

    expect(expectComplexSelector('h1 ~ p')).toMatchObject({
      parts: [
        typePart(null, 'h1'),
        typePart('~', 'p'),
      ],
    });
  });

  it('parses the column combinator', () => {
    expect(expectComplexSelector('col || td')).toMatchObject({
      parts: [
        typePart(null, 'col'),
        typePart('||', 'td'),
      ],
    });
  });

  it('parses a longer complex selector chain', () => {
    expect(expectComplexSelector('main > section .card + .card')).toMatchObject({
      parts: [
        typePart(null, 'main'),
        typePart('>', 'section'),
        classPart(' ', 'card'),
        classPart('+', 'card'),
      ],
    });
  });

  it('rejects doubled explicit combinators', () => {
    expectInvalidSelector('div > > span');
  });

  it('rejects a trailing explicit combinator', () => {
    expectInvalidSelector('div >');
  });

  it('rejects a malformed column combinator', () => {
    expectInvalidSelector('col ||| td');
  });
});

describe('selector parser pseudo-class selectors', () => {
  it('parses a known bare pseudo-class', () => {
    expect(expectComplexSelector(':hover')).toMatchObject({
      parts: [
        pseudoClassPart('hover', {
          argument: null,
        }),
      ],
    });
  });

  it('rejects an unknown bare pseudo-class', () => {
    expectInvalidSelector(':made-up');
  });

  it('rejects a bare pseudo-class used as a function', () => {
    expectInvalidSelector(':hover()');
  });

  it('rejects a functional pseudo-class used bare', () => {
    expectInvalidSelector(':is');
  });

  it('parses :is() as a forgiving selector-list pseudo-class argument', () => {
    expect(expectComplexSelector(':is(.foo, #bar)')).toMatchObject({
      parts: [
        pseudoClassPart('is', {
          argument: pseudoArgument(PseudoClassArgumentKind.ForgivingSelectorList, {
            selectors: selectorList([
              {
                parts: [
                  classPart(null, 'foo'),
                ],
              },
              {
                parts: [
                  idPart(null, 'bar'),
                ],
              },
            ]),
          }),
        }),
      ],
    });
  });

  it('parses :where() as a forgiving selector-list pseudo-class argument', () => {
    expect(expectComplexSelector(':where(.foo)')).toMatchObject({
      parts: [
        pseudoClassPart('where', {
          argument: pseudoArgument(PseudoClassArgumentKind.ForgivingSelectorList, {
            selectors: selectorList([
              {
                parts: [
                  classPart(null, 'foo'),
                ],
              },
            ]),
          }),
        }),
      ],
    });
  });

  it('parses :not() as a complex-real-selector-list pseudo-class argument', () => {
    expect(expectComplexSelector(':not(.foo, #bar)')).toMatchObject({
      parts: [
        pseudoClassPart('not', {
          argument: pseudoArgument(PseudoClassArgumentKind.ComplexRealSelectorList, {
            selectors: selectorList([
              {
                parts: [
                  {
                    combinator: null,
                    compound: compound(null, [
                      classSelector('foo'),
                    ]),
                  },
                ],
              },
              {
                parts: [
                  {
                    combinator: null,
                    compound: compound(null, [
                      idSelector('bar'),
                    ]),
                  },
                ],
              },
            ]),
          }),
        }),
      ],
    });
  });

  it('parses :has() as a relative-selector-list pseudo-class argument', () => {
    expect(expectComplexSelector(':has(> img)')).toMatchObject({
      parts: [
        pseudoClassPart('has', {
          argument: pseudoArgument(PseudoClassArgumentKind.RelativeSelectorList, {
            selectors: selectorList([
              {
                combinator: '>',
                selector: {
                  parts: [
                    typePart(null, 'img'),
                  ],
                },
              },
            ]),
          }),
        }),
      ],
    });
  });

  it('parses :host as a bare pseudo-class', () => {
    expect(expectComplexSelector(':host')).toMatchObject({
      parts: [
        pseudoClassPart('host', {
          argument: null,
        }),
      ],
    });
  });

  it('parses :host() as a compound-selector pseudo-class argument', () => {
    expect(expectComplexSelector(':host(.foo)')).toMatchObject({
      parts: [
        pseudoClassPart('host', {
          argument: pseudoArgument(PseudoClassArgumentKind.CompoundSelector, {
            selector: compound(null, [
              classSelector('foo'),
            ]),
          }),
        }),
      ],
    });
  });

  it('rejects :nth-child() until An+B parsing is implemented', () => {
    expectInvalidSelector(':nth-child(2n + 1)');
  });
});

describe('selector parser pseudo-element selectors', () => {
  it('parses legacy single-colon pseudo-elements', () => {
    expect(expectComplexSelector(':before')).toMatchObject({
      parts: [
        pseudoElementPart('before', {
          argument: null,
        }),
      ],
    });
  });

  it('parses double-colon pseudo-elements', () => {
    expect(expectComplexSelector('::before')).toMatchObject({
      parts: [
        pseudoElementPart('before', {
          argument: null,
        }),
      ],
    });
  });

  it('parses functional pseudo-elements with arguments', () => {
    expect(expectComplexSelector('::part(foo)')).toMatchObject({
      parts: [
        pseudoElementPart('part', {
          argument: pseudoElementArgument(PseudoElementArgumentKind.Ident, {
            value: 'foo',
          }),
        }),
      ],
    });
  });

  it('rejects functional pseudo-elements in single-colon form', () => {
    expectInvalidSelector(':part(foo)');
  });

  it('rejects functional pseudo-elements missing arguments', () => {
    expectInvalidSelector('::part');
  });

  it('rejects bare pseudo-elements used as functions', () => {
    expectInvalidSelector('::before()');
  });

  it('rejects unknown pseudo-elements', () => {
    expectInvalidSelector('::made-up');
  });

  it('parses pseudo-classes after pseudo-elements', () => {
    expect(expectComplexSelector('::before:hover')).toMatchObject({
      parts: [
        pseudoElementPart(
          'before',
          {
            argument: null,
          },
          [
            pseudoClass('hover', {
              argument: null,
            }),
          ],
        ),
      ],
    });
  });
});

const specificity = (a: number, b: number, c: number) => ({
  a, b, c,
});

describe('selector parser specificity', () => {
  it('computes simple selector specificity columns', () => {
    expect(expectComplexSelector('*').specificity).toEqual(specificity(0, 0, 0));
    expect(expectComplexSelector('div').specificity).toEqual(specificity(0, 0, 1));
    expect(expectComplexSelector('#foo').specificity).toEqual(specificity(1, 0, 0));
    expect(expectComplexSelector('.foo').specificity).toEqual(specificity(0, 1, 0));
    expect(expectComplexSelector('[href]').specificity).toEqual(specificity(0, 1, 0));
    expect(expectComplexSelector(':hover').specificity).toEqual(specificity(0, 1, 0));
    expect(expectComplexSelector('::before').specificity).toEqual(specificity(0, 0, 1));
  });

  it('sums specificity across compound and complex selectors', () => {
    expect(expectComplexSelector('div#main.foo[href]:hover').specificity)
      .toEqual(specificity(1, 3, 1));

    expect(expectComplexSelector('main > section .card + .card').specificity)
      .toEqual(specificity(0, 2, 2));

    expect(expectComplexSelector('::before:hover').specificity)
      .toEqual(specificity(0, 1, 1));
  });

  it('uses max specificity for selector lists', () => {
    const result = expectComplexSelectorList('*, div, .foo, #bar');

    expect(result.specificity).toEqual(specificity(1, 0, 0));
    expect(result.arms.map((arm) => arm.specificity)).toEqual([
      specificity(0, 0, 0),
      specificity(0, 0, 1),
      specificity(0, 1, 0),
      specificity(1, 0, 0),
    ]);
  });

  it('computes special pseudo-class specificity rules', () => {
    expect(expectComplexSelector(':is(.foo, #bar)').specificity)
      .toEqual(specificity(1, 0, 0));

    expect(expectComplexSelector(':where(#foo.bar)').specificity)
      .toEqual(specificity(0, 0, 0));

    expect(expectComplexSelector('.qux:where(em, #foo#bar#baz)').specificity)
      .toEqual(specificity(0, 1, 0));

    expect(expectComplexSelector(':has(> img)').specificity)
      .toEqual(specificity(0, 0, 1));

    expect(expectComplexSelector(':host(.foo)').specificity)
      .toEqual(specificity(0, 2, 0));
  });

  it('computes specificity for a tortured selector list', () => {
    const result = expectComplexSelectorList([
      '*',
      'main#app.layout[data-mode=dark]:hover > section.card:is(.featured, #hero) ::before:hover',
      '.shell:where(#ignored.deep[attr]) :has(> img.thumb[src])',
      ':host(.active)#root::before:hover',
    ].join(', '));

    expect(result.arms.map((arm) => arm.specificity)).toEqual([
      specificity(0, 0, 0),
      specificity(2, 5, 3),
      specificity(0, 3, 1),
      specificity(1, 3, 1),
    ]);

    expect(result.specificity).toEqual(specificity(2, 5, 3));
  });
});

describe('selector parser canonical AST', () => {
  it('canonicalizes legacy single-colon pseudo-elements', () => {
    for (const css of [':before', '::before']) {
      const selector = expectComplexSelector(css);

      expect(selector).toMatchObject({
        parts: [
          pseudoElementPart('before', {
            argument: null,
          }),
        ],
      });

      const pseudo = selector.parts[0].unit.pseudoCompounds[0].pseudoElement;

      expect(pseudo).not.toHaveProperty('legacy');
    }
  });
});
