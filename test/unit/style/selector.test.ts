import { describe, expect, it } from 'vitest';
import type {
  AttributeSelector, AttrMatcher, AttrModifier, Combinator, ComplexSelector, ComplexSelectorList, SelectorParserContext, WqName,
} from '../../../src/stylelet/parser/selector';
import { parseComplexSelectorList, parseSelectorList, PseudoArgumentKind, SelectorKind } from '../../../src/stylelet/parser/selector';

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
function rethrowFromCaller(error: unknown, caller: Function): never {
  if (error instanceof Error) {
    Error.captureStackTrace(error, caller);
  }

  throw error;
}

function expectComplexSelectorList(css: string, context: SelectorParserContext = {}): ComplexSelectorList {
  try {
    const result = parseComplexSelectorList(css, context);

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
    const result = parseSelectorList(css);
    expect(result, `Expected selector to be invalid: ${css}`).toBeNull();
  } catch (error) {
    rethrowFromCaller(error, expectInvalidSelector);
  }
}

// function expectValidSelector(css: string, context: SelectorParserContext = {}): ComplexSelectorList {
//   try {
//     const result = parseSelectorList(css, context);
//     expect(result, `Expected selector to be valid: ${css}`).not.toBeNull();
//     return result!;
//   } catch (error) {
//     rethrowFromCaller(error, expectValidSelector);
//   }
// }

// =============================================================================
// Expected selector AST builders
// =============================================================================

const typeSelector = (name: string, namespace?: string | null) => ({
  name,
  namespace: namespace ?? null,
});

const idSelector = (name: string) => ({
  kind: SelectorKind.IdSelector,
  name,
});

const classSelector = (name: string) => ({
  kind: SelectorKind.ClassSelector,
  name,
});

const attrName = (name: string, namespace?: string | null): WqName => ({
  name,
  namespace: namespace ?? null,
});

const attrSelector = (name: WqName | string, matcher?: AttrMatcher, value?: string, modifier?: AttrModifier) => {
  const attr: Partial<AttributeSelector> = {
    kind: SelectorKind.AttributeSelector,
    name: typeof name === 'string' ? attrName(name) : name,
  };
  if (matcher !== undefined) attr.matcher = matcher;
  if (value !== undefined) attr.value = value;
  if (modifier !== undefined) attr.modifier = modifier;
  return attr;
};

const compound = (typeSelectorValue: unknown = null, subclasses: unknown[] = []) => ({
  typeSelector: typeSelectorValue,
  subclasses,
});

const unit = (compoundValue: unknown = null, pseudoCompounds: unknown[] = []) => ({
  compound: compoundValue,
  pseudoCompounds,
});

const part = (combinator: Combinator | null, compoundValue: unknown = null, pseudoCompounds: unknown[] = []) => ({
  combinator,
  unit: unit(compoundValue, pseudoCompounds),
});

const typePart = (combinator: Combinator | null, name: string, namespace?: string | null) => part(
  combinator,
  compound(typeSelector(name, namespace)),
);

const idPart = (combinator: Combinator | null, name: string) => part(
  combinator,
  compound(null, [idSelector(name)]),
);

const classPart = (combinator: Combinator | null, name: string) => part(
  combinator,
  compound(null, [classSelector(name)]),
);

const attrPart = (combinator: Combinator | null, name: WqName | string, matcher?: AttrMatcher, value?: string, modifier?: AttrModifier) => part(
  combinator,
  compound(null, [attrSelector(name, matcher, value, modifier)]),
);

const pseudoClass = (name: string, argument?: unknown) => ({
  kind: SelectorKind.PseudoClassSelector,
  name,
  argument: argument ?? null,
});

const pseudoClassPart = (name: string, argument?: unknown) => part(
  null,
  compound(null, [
    pseudoClass(name, argument),
  ]),
);

const pseudoElement = (name: string, argument?: unknown) => ({
  kind: SelectorKind.PseudoElementSelector,
  name,
  argument: argument ?? null,
});

const pseudoCompound = (name: string, pseudoClasses: unknown[] = [], argument?: unknown) => ({
  kind: SelectorKind.PseudoCompoundSelector,
  pseudoElement: pseudoElement(name, argument),
  pseudoClasses,
});

const pseudoElementPart = (
  combinator: Combinator | null,
  name: string,
  pseudoClasses: unknown[] = [],
  argument?: unknown,
) => part(
  combinator,
  null,
  [
    pseudoCompound(name, pseudoClasses, argument),
  ],
);

const selectorList = (arms: unknown[]) => ({
  arms,
});

const realPart = (combinator: Combinator | null, compoundValue: unknown = null) => ({
  combinator,
  compound: compoundValue,
});

const realClassPart = (combinator: Combinator | null, name: string) => realPart(
  combinator,
  compound(null, [classSelector(name)]),
);

const realIdPart = (combinator: Combinator | null, name: string) => realPart(
  combinator,
  compound(null, [idSelector(name)]),
);

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
        typePart(null, 'circle', 'svg'),
      ],
    });
  });

  it('parses an empty namespace prefix', () => {
    expect(expectComplexSelector('|circle')).toMatchObject({
      parts: [
        typePart(null, 'circle', ''),
      ],
    });
  });

  it('parses a wildcard namespace prefix', () => {
    expect(expectComplexSelector('*|circle')).toMatchObject({
      parts: [
        typePart(null, 'circle', '*'),
      ],
    });
  });

  it('parses a namespace-qualified universal selector', () => {
    expect(expectComplexSelector('svg|*')).toMatchObject({
      parts: [
        typePart(null, '*', 'svg'),
      ],
    });
  });

  it('parses a wildcard namespace universal selector', () => {
    expect(expectComplexSelector('*|*')).toMatchObject({
      parts: [
        typePart(null, '*', '*'),
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
        attrPart(null, 'href', '=', 'example'),
      ],
    });
  });

  it('parses an exact-match attribute selector with string value', () => {
    expect(expectComplexSelector('[href="example"]')).toMatchObject({
      parts: [
        attrPart(null, 'href', '=', 'example'),
      ],
    });
  });

  it('parses attribute selector whitespace around components', () => {
    expect(expectComplexSelector('[ href = example ]')).toMatchObject({
      parts: [
        attrPart(null, 'href', '=', 'example'),
      ],
    });
  });

  it('parses all attribute matcher prefixes', () => {
    for (const matcher of ['~=', '|=', '^=', '$=', '*='] as const) {
      expect(expectComplexSelector(`[a${matcher}b]`), matcher).toMatchObject({
        parts: [
          attrPart(null, 'a', matcher, 'b'),
        ],
      });
    }
  });

  it('parses an ASCII case-insensitive attribute modifier', () => {
    expect(expectComplexSelector('[href=example i]')).toMatchObject({
      parts: [
        attrPart(null, 'href', '=', 'example', 'i'),
      ],
    });
  });

  it('parses an ASCII case-sensitive attribute modifier', () => {
    expect(expectComplexSelector('[href=example s]')).toMatchObject({
      parts: [
        attrPart(null, 'href', '=', 'example', 's'),
      ],
    });
  });

  it('parses a namespaced attribute name', () => {
    expect(expectComplexSelector('[svg|href=value]')).toMatchObject({
      parts: [
        attrPart(null, attrName('href', 'svg'), '='),
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
        pseudoClassPart('hover'),
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
          kind: PseudoArgumentKind.ForgivingSelectorList,
          selectors: selectorList([
            {
              parts: [
                realClassPart(null, 'foo'),
              ],
            },
            {
              parts: [
                realIdPart(null, 'bar'),
              ],
            },
          ]),
        }),
      ],
    });
  });

  it('parses :where() as a forgiving selector-list pseudo-class argument', () => {
    expect(expectComplexSelector(':where(.foo)')).toMatchObject({
      parts: [
        pseudoClassPart('where', {
          kind: PseudoArgumentKind.ForgivingSelectorList,
          selectors: selectorList([
            {
              parts: [
                realClassPart(null, 'foo'),
              ],
            },
          ]),
        }),
      ],
    });
  });

  it('parses :not() as a complex-real-selector-list pseudo-class argument', () => {
    expect(expectComplexSelector(':not(.foo, #bar)')).toMatchObject({
      parts: [
        pseudoClassPart('not', {
          kind: PseudoArgumentKind.ComplexRealSelectorList,
          selectors: selectorList([
            {
              parts: [
                realClassPart(null, 'foo'),
              ],
            },
            {
              parts: [
                realIdPart(null, 'bar'),
              ],
            },
          ]),
        }),
      ],
    });
  });

  it('parses :has() as a relative-selector-list pseudo-class argument', () => {
    expect(expectComplexSelector(':has(> img)')).toMatchObject({
      parts: [
        pseudoClassPart('has', {
          kind: PseudoArgumentKind.RelativeSelectorList,
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
      ],
    });
  });

  it('parses :host as a bare pseudo-class', () => {
    expect(expectComplexSelector(':host')).toMatchObject({
      parts: [
        pseudoClassPart('host'),
      ],
    });
  });

  it('parses :host() as a compound-selector pseudo-class argument', () => {
    expect(expectComplexSelector(':host(.foo)')).toMatchObject({
      parts: [
        pseudoClassPart('host', {
          kind: PseudoArgumentKind.CompoundSelector,
          selector: compound(null, [
            classSelector('foo'),
          ]),
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
        pseudoElementPart(null, 'before'),
      ],
    });
  });

  it('parses double-colon pseudo-elements', () => {
    expect(expectComplexSelector('::before')).toMatchObject({
      parts: [
        pseudoElementPart(null, 'before'),
      ],
    });
  });

  it('parses functional pseudo-elements with arguments', () => {
    expect(expectComplexSelector('::part(foo)')).toMatchObject({
      parts: [
        pseudoElementPart(null, 'part', [], {
          kind: PseudoArgumentKind.PartNameList,
          names: ['foo'],
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
        pseudoElementPart(null, 'before', [pseudoClass('hover')]),
      ],
    });
  });

  // it('threads pseudo-element-tail validity restrictions through logical pseudo arguments', () => {
  //   const expectForgivingTailPseudoNames = (css: string, expectedNames: string[]) => {
  //     const selector = expectComplexSelector(css);
  //     const pseudoClasses = selector.parts[0].unit.pseudoCompounds[0].pseudoClasses;

  //     expect(pseudoClasses, css).toHaveLength(1);
  //     expect(pseudoClasses[0].name, css).toBe('is');
  //     expect(pseudoClasses[0].argument, css).toMatchObject({
  //       kind: PseudoArgumentKind.ForgivingSelectorList,
  //     });

  //     const argument = pseudoClasses[0].argument;
  //     if (argument?.kind !== PseudoArgumentKind.ForgivingSelectorList) {
  //       throw new Error(`Expected :is() forgiving argument for ${css}`);
  //     }

  //     const names = argument.selectors.arms.map((arm) => {
  //       expect(arm.parts, css).toHaveLength(1);
  //       expect(arm.parts[0].compound.typeSelector, css).toBeNull();
  //       expect(arm.parts[0].compound.subclasses, css).toHaveLength(1);

  //       const subclass = arm.parts[0].compound.subclasses[0];

  //       expect(subclass.kind, css).toBe(SelectorKind.PseudoClassSelector);

  //       return subclass.name;
  //     });

  //     expect(names, css).toEqual(expectedNames);
  //   };

  //   // Direct tail: logical and user-action pseudo-classes are valid.
  //   for (const css of [
  //     '::before:hover',
  //     '::before:active',
  //     '::before:focus',
  //     '::before:focus-visible',
  //     '::before:focus-within',
  //     '::before:is(:hover)',
  //     '::before:where(:hover)',
  //     '::before:not(:hover)',
  //   ]) {
  //     expectValidSelector(css);
  //   }

  //   // Direct tail: non-logical, non-user-action pseudo-classes are invalid.
  //   for (const css of [
  //     '::before:defined',
  //     '::before:dir(ltr)',
  //     '::before:lang(en)',
  //     '::before:any-link',
  //     '::before:scope',
  //     '::before:has(*)',
  //     '::before:enabled',
  //     '::before:root',
  //     '::before:nth-of-type(1)',
  //   ]) {
  //     expectInvalidSelector(css);
  //   }

  //   // Direct tail: ordinary selectors/combinators cannot appear after the pseudo-element.
  //   for (const css of [
  //     '::before.foo',
  //     '::before#id',
  //     '::before[hidden]',
  //     '::before*',
  //     '::before div',
  //     '::before > div',
  //     '::before + div',
  //     '::before ~ div',
  //   ]) {
  //     expectInvalidSelector(css);
  //   }

  //   // Forgiving logical arguments inherit pseudo-element-tail restrictions.
  //   // Invalid ordinary selector arms are dropped, leaving only valid tail pseudos.
  //   expectForgivingTailPseudoNames(
  //     '::before:is(*, div, #id, .foo, [hidden], :hover)',
  //     ['hover'],
  //   );

  //   expectForgivingTailPseudoNames(
  //     '::before:is(:defined, :dir(ltr), :lang(en), :has(*), :active)',
  //     ['active'],
  //   );

  //   // Complex arms are invalid in the pseudo-element tail, even when their first
  //   // compound starts with an otherwise-valid user-action pseudo-class.
  //   expectForgivingTailPseudoNames(
  //     '::before:is(:hover > .x, :active + .y, :focus)',
  //     ['focus'],
  //   );

  //   // Nested forgiving pseudos also inherit the pseudo-element-tail restrictions.
  //   // The inner :where(*, .foo, :hover) should keep only :hover.
  //   expect(expectComplexSelector('::before:is(:where(*, .foo, :hover), :active)')).toMatchObject({
  //     parts: [
  //       pseudoElementPart(null, 'before', [
  //         pseudoClass('is', {
  //           kind: PseudoArgumentKind.ForgivingSelectorList,
  //           selectors: selectorList([
  //             {
  //               parts: [
  //                 realPart(null, compound(null, [
  //                   pseudoClass('where', {
  //                     kind: PseudoArgumentKind.ForgivingSelectorList,
  //                     selectors: selectorList([
  //                       {
  //                         parts: [
  //                           realPart(null, compound(null, [
  //                             pseudoClass('hover'),
  //                           ])),
  //                         ],
  //                       },
  //                     ]),
  //                   }),
  //                 ])),
  //               ],
  //             },
  //             {
  //               parts: [
  //                 realPart(null, compound(null, [
  //                   pseudoClass('active'),
  //                 ])),
  //               ],
  //             },
  //           ]),
  //         }),
  //       ]),
  //     ],
  //   });

  //   // :not is strict. Contextual invalidity inside :not poisons the whole selector.
  //   for (const css of [
  //     '::before:not(.foo)',
  //     '::before:not(#id)',
  //     '::before:not([hidden])',
  //     '::before:not(div)',
  //     '::before:not(*)',
  //     '::before:not(:defined)',
  //     '::before:not(:has(*))',
  //     '::before:not(:hover > .x)',
  //     '::before:not(:not(.foo))',
  //   ]) {
  //     expectInvalidSelector(css);
  //   }

  //   // But :not() may contain a forgiving logical pseudo whose own bad arms
  //   // have been dropped under the inherited pseudo-element-tail restrictions.
  //   for (const css of [
  //     '::before:not(:is(.foo))',
  //     '::before:not(:where(.foo, #id, [hidden]))',
  //     '::before:not(:is(:has(*), div, .foo))',
  //     '::before:not(:is(:hover))',
  //     '::before:not(:where(:focus-visible))',
  //   ]) {
  //     expectValidSelector(css);
  //   }
  // });

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
          pseudoElementPart(null, 'before'),
        ],
      });

      const pseudo = selector.parts[0].unit.pseudoCompounds[0].pseudoElement;

      expect(pseudo).not.toHaveProperty('legacy');
    }
  });

  it('does not allow pseudo-compounds where compound selectors are required', () => {
    expectInvalidSelector(':host(::before)');
    expectInvalidSelector(':host(.foo::before)');
  });

  it('distinguishes originating-element adjacency from descendant pseudo-element selection', () => {
    expect(expectComplexSelector('.foo::before')).toMatchObject({
      parts: [
        part(
          null,
          compound(null, [classSelector('foo')]),
          [
            pseudoCompound('before'),
          ],
        ),
      ],
    });

    expect(expectComplexSelector('.foo ::before')).toMatchObject({
      parts: [
        classPart(null, 'foo'),
        pseudoElementPart(' ', 'before'),
      ],
    });
  });

  it('represents chained pseudo-elements as separate pseudo-compounds', () => {
    expect(expectComplexSelector('.foo::before::marker')).toMatchObject({
      parts: [
        part(
          null,
          compound(null, [classSelector('foo')]),
          [
            pseudoCompound('before'),
            pseudoCompound('marker'),
          ],
        ),
      ],
    });
  });

  it('rejects a type or universal selector after subclass selectors in the same compound', () => {
    expectInvalidSelector('.foo*');
    expectInvalidSelector('#foo*');
    expectInvalidSelector('[href]div');
    expectInvalidSelector('div*');
  });
});

it('drops invalid arms from forgiving selector-list pseudo-class arguments', () => {
  expect(expectComplexSelector(':is(.foo ???, #bar)')).toMatchObject({
    parts: [
      pseudoClassPart('is', {
        kind: PseudoArgumentKind.ForgivingSelectorList,
        selectors: selectorList([
          {
            parts: [
              realIdPart(null, 'bar'),
            ],
          },
        ]),
      }),
    ],
  });
});

it('allows forgiving selector-list pseudo-class arguments to become empty', () => {
  expect(expectComplexSelector(':is(???, !!!)')).toMatchObject({
    parts: [
      pseudoClassPart('is', {
        kind: PseudoArgumentKind.ForgivingSelectorList,
        selectors: selectorList([]),
      }),
    ],
  });
});

it('parses whitespace-separated ::part() names', () => {
  expect(expectComplexSelector('::part( foo active )')).toMatchObject({
    parts: [
      pseudoElementPart(null, 'part', [], {
        kind: PseudoArgumentKind.PartNameList,
        names: ['foo', 'active'],
      }),
    ],
  });
});

it('rejects comma-separated ::part() names', () => {
  expectInvalidSelector('::part(foo, active)');
});

it('parses ::highlight() with a custom-ident argument', () => {
  expect(expectComplexSelector('::highlight(foo)')).toMatchObject({
    parts: [
      pseudoElementPart(null, 'highlight', [], {
        kind: PseudoArgumentKind.CustomIdent,
        value: {
          type: 'custom-ident',
          value: 'foo',
        },
      }),
    ],
  });
});

it('rejects CSS-wide keywords as ::highlight() names', () => {
  expectInvalidSelector('::highlight(inherit)');
  expectInvalidSelector('::highlight(initial)');
  expectInvalidSelector('::highlight(unset)');
  expectInvalidSelector('::highlight(revert)');
  expectInvalidSelector('::highlight(revert-layer)');
});

it('parses ::slotted() with a compound-selector argument', () => {
  expect(expectComplexSelector('::slotted(.foo)')).toMatchObject({
    parts: [
      pseudoElementPart(null, 'slotted', [], {
        kind: PseudoArgumentKind.CompoundSelector,
        selector: compound(null, [
          classSelector('foo'),
        ]),
      }),
    ],
  });
});

it('rejects pseudo-compounds inside ::slotted() compound-selector arguments', () => {
  expectInvalidSelector('::slotted(.foo::before)');
});

it('parses :host-context() as a compound-selector pseudo-class argument', () => {
  expect(expectComplexSelector(':host-context(.theme)')).toMatchObject({
    parts: [
      pseudoClassPart('host-context', {
        kind: PseudoArgumentKind.CompoundSelector,
        selector: compound(null, [
          classSelector('theme'),
        ]),
      }),
    ],
  });
});

it('parses :has-slotted as a bare pseudo-class', () => {
  expect(expectComplexSelector(':has-slotted')).toMatchObject({
    parts: [
      pseudoClassPart('has-slotted'),
    ],
  });
});

it('rejects functional :has-slotted() for now', () => {
  expectInvalidSelector(':has-slotted(*)');
});

it('parses CSS Pseudo 4 bare pseudo-elements', () => {
  expect(expectComplexSelector('::selection')).toMatchObject({
    parts: [
      pseudoElementPart(null, 'selection'),
    ],
  });

  expect(expectComplexSelector('::target-text')).toMatchObject({
    parts: [
      pseudoElementPart(null, 'target-text'),
    ],
  });

  expect(expectComplexSelector('::file-selector-button')).toMatchObject({
    parts: [
      pseudoElementPart(null, 'file-selector-button'),
    ],
  });

  expect(expectComplexSelector('::details-content')).toMatchObject({
    parts: [
      pseudoElementPart(null, 'details-content'),
    ],
  });
});

it('computes specificity for shadow and highlight pseudo-elements', () => {
  expect(expectComplexSelector('::highlight(foo)').specificity)
    .toEqual(specificity(0, 0, 1));

  expect(expectComplexSelector('::part(foo active)').specificity)
    .toEqual(specificity(0, 0, 1));

  expect(expectComplexSelector('::slotted(.foo)').specificity)
    .toEqual(specificity(0, 1, 1));
});

it('parses :dir(ltr) and :dir(rtl)', () => {
  expect(expectComplexSelector(':dir(ltr)')).toMatchObject({
    parts: [
      pseudoClassPart('dir', {
        kind: PseudoArgumentKind.Direction,
        value: 'ltr',
      }),
    ],
  });

  expect(expectComplexSelector(':dir(RTL)')).toMatchObject({
    parts: [
      pseudoClassPart('dir', {
        kind: PseudoArgumentKind.Direction,
        value: 'rtl',
      }),
    ],
  });
});

it('parses unknown :dir() identifiers as non-matching directions', () => {
  expect(expectComplexSelector(':dir(sideways)')).toMatchObject({
    parts: [
      pseudoClassPart('dir', {
        kind: PseudoArgumentKind.Direction,
        value: null,
      }),
    ],
  });
});

it('rejects syntactically invalid :dir() arguments', () => {
  expectInvalidSelector(':dir()');
  expectInvalidSelector(':dir("ltr")');
  expectInvalidSelector(':dir(ltr rtl)');
  expectInvalidSelector(':dir(>)');
});
