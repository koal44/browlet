import { describe, expect, it } from 'vitest';
import type {
  AttributeSelector, AttrMatcher, AttrModifier, Combinator, ComplexSelector, ComplexSelectorList,
  SelectorParserContext, WqName,
} from '../../../../src/stylelet/syntax/selector';
import {
  parseComplexSelectorList, parseSelectorList, PseudoArgumentKind,
  SelectorKind,
} from '../../../../src/stylelet/syntax/selector';

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

function expectComplexSelector(css: string, context: SelectorParserContext = {}): ComplexSelector {
  try {
    const result = expectComplexSelectorList(css, context);

    expect(result.arms, `Expected exactly one selector for: ${css}`).toHaveLength(1);

    return result.arms[0];
  } catch (error) {
    rethrowFromCaller(error, expectComplexSelector);
  }
}

function expectInvalidSelector(css: string, context: SelectorParserContext = {}): void {
  try {
    const result = parseSelectorList(css, context);
    expect(result, `Expected selector to be invalid: ${css}`).toBeNull();
  } catch (error) {
    rethrowFromCaller(error, expectInvalidSelector);
  }
}

function expectValidSelector(css: string, context: SelectorParserContext = {}): ComplexSelectorList {
  try {
    const result = parseSelectorList(css, context);
    expect(result, `Expected selector to be valid: ${css}`).not.toBeNull();
    return result!;
  } catch (error) {
    rethrowFromCaller(error, expectValidSelector);
  }
}

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

const attrName = (localName: string, namespace?: string | null): WqName => ({
  localName,
  namespace: namespace ?? null,
});

const attrSelector = (name: WqName | string, matcher?: AttrMatcher, value?: string, modifier?: AttrModifier) => {
  const attr: Partial<AttributeSelector> = {
    kind: SelectorKind.AttributeSelector,
    wqName: typeof name === 'string' ? attrName(name) : name,
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

const specificity = (a: number, b: number, c: number) => ({
  a, b, c,
});

// pre-defined context
const namespaceContext: SelectorParserContext = {
  declaredNamespacePrefixes: new Set(['svg', 'xlink']),
};

describe('selector lists', () => {
  it('rejects an empty selector list', () => {
    expectInvalidSelector('');
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
});

describe('simple and compound selectors', () => {
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

  it('rejects a type or universal selector after subclass selectors in the same compound', () => {
    expectInvalidSelector('.foo*');
    expectInvalidSelector('#foo*');
    expectInvalidSelector('[href]div');
    expectInvalidSelector('div*');
  });
});

describe('namespaces', () => {
  it('parses a namespace-qualified type selector', () => {
    expect(expectComplexSelector('svg|circle', namespaceContext)).toMatchObject({
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
    expect(expectComplexSelector('svg|*', namespaceContext)).toMatchObject({
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

  it('requires declarations for named namespace prefixes across selector arguments', () => {
    expectComplexSelector('svg|circle', namespaceContext);
    expectComplexSelector('svg|*', namespaceContext);

    expectInvalidSelector('svg|circle');
    expectInvalidSelector('svg|*');
    expectInvalidSelector('math|mi', namespaceContext);

    // Prefixes are case-sensitive.
    expectInvalidSelector('SVG|circle', namespaceContext);

    // These never require declarations.
    expectValidSelector('|circle');
    expectValidSelector('|*');
    expectValidSelector('*|circle');
    expectValidSelector('*|*');

    // Attribute selectors
    expectComplexSelector('[xlink|href]', namespaceContext);

    expectInvalidSelector('[xlink|href]');
    expectInvalidSelector('[math|value]', namespaceContext);

    // These never require declarations.
    expectValidSelector('[href]');
    expectValidSelector('[|href]');
    expectValidSelector('[*|href]');

    // context threading
    expectValidSelector(':not(svg|circle[xlink|href])', namespaceContext);
    expectInvalidSelector(':not(svg|circle[xlink|href])');

    expectValidSelector(':has(> svg|circle[xlink|href])', namespaceContext);
    expectInvalidSelector(':has(> svg|circle[xlink|href])');

    expectValidSelector('::slotted(svg|circle[xlink|href])', namespaceContext);
    expectInvalidSelector('::slotted(svg|circle[xlink|href])');
  });
});

describe('attribute selectors', () => {
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

  it('parses whitespace around components', () => {
    expect(expectComplexSelector('[ href = example ]')).toMatchObject({
      parts: [
        attrPart(null, 'href', '=', 'example'),
      ],
    });
  });

  it('parses every attribute match operator', () => {
    for (const matcher of ['~=', '|=', '^=', '$=', '*='] as const) {
      expect(expectComplexSelector(`[a${matcher}b]`), matcher).toMatchObject({
        parts: [
          attrPart(null, 'a', matcher, 'b'),
        ],
      });
    }
  });

  it('parses the ASCII case-insensitive modifier', () => {
    expect(expectComplexSelector('[href=example i]')).toMatchObject({
      parts: [
        attrPart(null, 'href', '=', 'example', 'i'),
      ],
    });
  });

  it('parses the ASCII case-sensitive modifier', () => {
    expect(expectComplexSelector('[href=example s]')).toMatchObject({
      parts: [
        attrPart(null, 'href', '=', 'example', 's'),
      ],
    });
  });

  it('parses a namespaced attribute name', () => {
    expect(expectComplexSelector('[svg|href=value]', namespaceContext)).toMatchObject({
      parts: [
        attrPart(null, attrName('href', 'svg'), '='),
      ],
    });
  });

  it('rejects an empty attribute selector', () => {
    expectInvalidSelector('[]');
  });

  it('rejects a missing matcher value', () => {
    expectInvalidSelector('[href=]');
  });

  it('rejects a matcher split by whitespace', () => {
    expectInvalidSelector('[href ~ = value]');
  });

  it('rejects an unsupported modifier', () => {
    expectInvalidSelector('[href=value q]');
  });

  it('rejects trailing garbage', () => {
    expectInvalidSelector('[href value]');
  });
});

describe('complex selectors and combinators', () => {
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

describe('pseudo-class selectors', () => {
  describe('recognition and argument forms', () => {
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
  });

  describe('logical combination pseudo-classes', () => {
    it('parses :is() with a forgiving selector list', () => {
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

    it('parses :where() with a forgiving selector list', () => {
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

    it('parses :not() with a strict complex-real selector list', () => {
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
  });

  describe(':has()', () => {
    it('parses a relative selector list', () => {
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

    it.each([
      ':has(:has(.b))',
      ':has(:not(:has(.b)))',
      ':has(::before)',
      ':has(:not(::before))',
    ])('rejects nested :has() or pseudo-elements in %s', (css) => {
      expectInvalidSelector(css);
    });

    it('drops nested :has() and pseudo-elements from forgiving arms inside :has()', () => {
      expect(expectComplexSelector(':has(:is(:has(.b), ::before, .a))')).toMatchObject({
        parts: [
          pseudoClassPart('has', {
            kind: PseudoArgumentKind.RelativeSelectorList,
            selectors: selectorList([
              {
                combinator: null,
                selector: {
                  parts: [
                    part(null, compound(null, [
                      pseudoClass('is', {
                        kind: PseudoArgumentKind.ForgivingSelectorList,
                        selectors: selectorList([
                          {
                            parts: [
                              realClassPart(null, 'a'),
                            ],
                          },
                        ]),
                      }),
                    ])),
                  ],
                },
              },
            ]),
          }),
        ],
      });
    });

    it.each([
      ':has(:is(:has(.b)))',
      ':has(:is(::before))',
    ])('accepts %s after its forgiving selector list becomes empty', (css) => {
      expectValidSelector(css);
    });
  });

  describe('An+B and structural pseudo-classes', () => {
    it.each([
      ['odd', 2, 1],
      ['EVEN', 2, 0],
      ['1', 0, 1],
      ['+1', 0, 1],
      ['-1', 0, -1],
      ['n', 1, 0],
      ['+n', 1, 0],
      ['-n', -1, 0],
      ['2n', 2, 0],
      ['+2n', 2, 0],
      ['-2n', -2, 0],
      ['n+1', 1, 1],
      ['n + 1', 1, 1],
      ['n +1', 1, 1],
      ['n-1', 1, -1],
      ['n - 1', 1, -1],
      ['n -1', 1, -1],
      ['2n+3', 2, 3],
      ['2n + 3', 2, 3],
      ['2n-123', 2, -123],
      ['+n-123', 1, -123],
      ['-n-123', -1, -123],
      ['2n- 123', 2, -123],
      ['+n- 123', 1, -123],
      ['-n- 123', -1, -123],
      ['-0n+0', 0, 0],
      ['N-12', 1, -12],
      ['n/**/+1', 1, 1],
      ['+/**/n', 1, 0],
      ['n\\2d 12', 1, -12],
    ] as const)('parses :nth-child(%s) as An+B (%i, %i)', (formula, a, b) => {
      expect(expectComplexSelector(`:nth-child(${formula})`)).toMatchObject({
        parts: [
          pseudoClassPart('nth-child', {
            kind: PseudoArgumentKind.NthChild,
            formula: { a, b },
            of: null,
          }),
        ],
      });
    });

    it.each([
      '',
      '+ n',
      '+ 2n',
      '3 n',
      '3n + -6',
      'n + +1',
      'n - -1',
      '1.0',
      '2.0n',
      '1e0',
      'n 1',
      'n- -1',
      'foo',
      '2nn',
      '+/**/ n',
      'n/**/ 1',
      '2n+-1',
      'n--1',
    ])('rejects invalid :nth-child(%s) An+B syntax', (formula) => {
      expectInvalidSelector(`:nth-child(${formula})`);
    });

    it.each([
      'nth-child',
      'nth-last-child',
      'nth-of-type',
      'nth-last-of-type',
    ])('parses An+B arguments for :%s()', (name) => {
      expect(expectComplexSelector(`:${name}(2n + 1)`)).toMatchObject({
        parts: [
          pseudoClassPart(name, {
            kind: name.includes('of-type')
              ? PseudoArgumentKind.AnPlusB
              : PseudoArgumentKind.NthChild,
            ...(name.includes('of-type')
              ? { a: 2, b: 1 }
              : { formula: { a: 2, b: 1 } }),
          }),
        ],
      });
    });

    it('parses the of selector list in :nth-child()', () => {
      expect(expectComplexSelector(':nth-child(2n + 1 of .item, [hidden])')).toMatchObject({
        parts: [
          pseudoClassPart('nth-child', {
            kind: PseudoArgumentKind.NthChild,
            formula: { a: 2, b: 1 },
            of: selectorList([
              {
                parts: [
                  realClassPart(null, 'item'),
                ],
              },
              {
                parts: [
                  realPart(null, compound(null, [attrSelector('hidden')])),
                ],
              },
            ]),
          }),
        ],
      });
    });

    it('parses complex selectors in the :nth-last-child() of list', () => {
      expectValidSelector(':nth-last-child(odd of article > .entry)');
    });

    it.each([
      ':nth-child(2n of)',
      ':nth-child(2n of .item,)',
      ':nth-child(2n of > .item)',
      ':nth-of-type(2n of .item)',
    ])('rejects invalid An+B/of syntax in %s', (selector) => {
      expectInvalidSelector(selector);
    });
  });

  describe('shadow pseudo-classes', () => {
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
  });

  describe(':lang()', () => {
    it('parses a comma-separated list of language ranges', () => {
      expect(expectComplexSelector(':lang(en, "*-Latn")')).toMatchObject({
        parts: [
          pseudoClassPart('lang', {
            kind: PseudoArgumentKind.LanguageRangeList,
            ranges: ['en', '*-Latn'],
          }),
        ],
      });
    });

    it('parses escaped wildcard and empty-string language ranges', () => {
      expect(expectComplexSelector(String.raw`:lang(\*-CH, "")`)).toMatchObject({
        parts: [
          pseudoClassPart('lang', {
            kind: PseudoArgumentKind.LanguageRangeList,
            ranges: ['*-CH', ''],
          }),
        ],
      });
    });

    it('accepts a CSS identifier that is not a well-formed BCP 47 language range', () => {
      expect(expectComplexSelector(':lang(åå)')).toMatchObject({
        parts: [
          pseudoClassPart('lang', {
            kind: PseudoArgumentKind.LanguageRangeList,
            ranges: ['åå'],
          }),
        ],
      });
    });

    it('rejects syntactically invalid :lang() arguments', () => {
      expectInvalidSelector(':lang()');
      expectInvalidSelector(':lang(*)');
      expectInvalidSelector(':lang(en,)');
      expectInvalidSelector(':lang(en fr)');
    });
  });

  describe(':dir()', () => {
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
  });

  describe('Selectors Level 5 pseudo-classes', () => {
    it.each([
      'local-link',
      'interest-source',
      'interest-target',
      'blank',
      'current',
      'past',
      'future',
      'heading',
    ])('parses :%s as a bare pseudo-class', (name) => {
      expect(expectComplexSelector(`:${name}`)).toMatchObject({
        parts: [pseudoClassPart(name)],
      });
    });

    it('parses :local-link() with one non-negative integer', () => {
      expect(expectComplexSelector(':local-link(2)')).toMatchObject({
        parts: [
          pseudoClassPart('local-link', {
            kind: PseudoArgumentKind.Integer,
            value: 2,
          }),
        ],
      });
    });

    it.each([
      ':local-link()',
      ':local-link(-1)',
      ':local-link(1.0)',
      ':local-link(1, 2)',
    ])('rejects invalid functional local-link syntax in %s', (selector) => {
      expectInvalidSelector(selector);
    });

    it('parses :current() with a compound-selector list', () => {
      expect(expectComplexSelector(':current(p, .active)')).toMatchObject({
        parts: [
          pseudoClassPart('current', {
            kind: PseudoArgumentKind.CompoundSelectorList,
            selectors: {
              kind: SelectorKind.CompoundSelectorList,
              arms: [
                compound(typeSelector('p')),
                compound(null, [classSelector('active')]),
              ],
            },
          }),
        ],
      });
    });

    it.each([
      ':current()',
      ':current(.a > .b)',
      ':current(.a,)',
      ':current(> .a)',
    ])('rejects invalid :current() compound-selector lists in %s', (selector) => {
      expectInvalidSelector(selector);
    });

    it('parses :state() with a case-preserving ident argument', () => {
      expect(expectComplexSelector(':state(Ready)')).toMatchObject({
        parts: [
          pseudoClassPart('state', {
            kind: PseudoArgumentKind.Ident,
            value: 'Ready',
          }),
        ],
      });
    });

    it.each([
      ':state',
      ':state()',
      ':state("ready")',
      ':state(ready now)',
    ])('rejects invalid :state() syntax in %s', (selector) => {
      expectInvalidSelector(selector);
    });

    it('parses :heading() with a comma-separated integer list', () => {
      expect(expectComplexSelector(':heading(1, 2, -1)')).toMatchObject({
        parts: [
          pseudoClassPart('heading', {
            kind: PseudoArgumentKind.IntegerList,
            values: [1, 2, -1],
          }),
        ],
      });
    });

    it.each([
      ':heading()',
      ':heading(1.0)',
      ':heading(1 2)',
      ':heading(1,)',
    ])('rejects invalid functional heading syntax in %s', (selector) => {
      expectInvalidSelector(selector);
    });

    it.each([
      'nth-col',
      'nth-last-col',
    ])('parses An+B arguments for :%s()', (name) => {
      expect(expectComplexSelector(`:${name}(2n + 1)`)).toMatchObject({
        parts: [
          pseudoClassPart(name, {
            kind: PseudoArgumentKind.AnPlusB,
            a: 2,
            b: 1,
          }),
        ],
      });
    });

    it.each([
      ':nth-col',
      ':nth-last-col()',
      ':nth-col(2n of .item)',
    ])('rejects invalid grid-structural pseudo-class syntax in %s', (selector) => {
      expectInvalidSelector(selector);
    });

    it('classifies the interest pseudo-classes as user-action tails', () => {
      expectValidSelector('::before:interest-source');
      expectValidSelector('::before:interest-target');
      expectInvalidSelector('::before:blank');
      expectInvalidSelector('::before:state(ready)');
    });
  });
});

describe('pseudo-element selectors', () => {
  describe('recognition and argument forms', () => {
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

    it('recognizes CSS Pseudo 4 bare pseudo-elements', () => {
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
  });

  describe('::part()', () => {
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
  });

  describe('::highlight()', () => {
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

    it('rejects reserved custom-ident keywords as ::highlight() names', () => {
      expectInvalidSelector('::highlight(inherit)');
      expectInvalidSelector('::highlight(initial)');
      expectInvalidSelector('::highlight(unset)');
      expectInvalidSelector('::highlight(revert)');
      expectInvalidSelector('::highlight(revert-layer)');
      expectInvalidSelector('::highlight(default)');
    });
  });

  describe('::slotted()', () => {
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
  });

  describe('pseudo-class tails', () => {
    it('parses pseudo-classes after pseudo-elements', () => {
      expect(expectComplexSelector('::before:hover')).toMatchObject({
        parts: [
          pseudoElementPart(null, 'before', [pseudoClass('hover')]),
        ],
      });
    });

    it('applies pseudo-element-tail validity inside logical pseudo arguments', () => {
      function expectForgivingTailIsNames(css: string, expectedNames: string[]): void {
        try {
          const selector = expectComplexSelector(css);
          const pseudoClasses = selector.parts[0].unit.pseudoCompounds[0].pseudoClasses;

          expect(pseudoClasses, css).toHaveLength(1);
          expect(pseudoClasses[0].name, css).toBe('is');
          expect(pseudoClasses[0].argument, css).toMatchObject({
            kind: PseudoArgumentKind.ForgivingSelectorList,
          });

          const argument = pseudoClasses[0].argument;

          if (argument?.kind !== PseudoArgumentKind.ForgivingSelectorList) {
            throw new Error(`Expected :is() forgiving argument for ${css}`);
          }

          const names = argument.selectors.arms.map((arm, index) => {
            expect(arm.parts, `${css} arm ${index}`).toHaveLength(1);

            const part = arm.parts[0];
            expect(part.compound.typeSelector, `${css} arm ${index}`).toBeNull();
            expect(part.compound.subclasses, `${css} arm ${index}`).toHaveLength(1);

            const subclass = part.compound.subclasses[0];

            if (subclass.kind !== SelectorKind.PseudoClassSelector) {
              throw new Error(`Expected pseudo-class in ${css} arm ${index}`);
            }

            return subclass.name;
          });

          expect(names, css).toEqual(expectedNames);
        } catch (error) {
          rethrowFromCaller(error, expectForgivingTailIsNames);
        }
      }

      // Direct tail: logical and user-action pseudo-classes are valid.
      for (const css of [
        '::before:hover',
        '::before:active',
        '::before:focus',
        '::before:focus-visible',
        '::before:focus-within',
        '::before:is(:hover)',
        '::before:where(:hover)',
        '::before:not(:hover)',
      ]) {
        expectValidSelector(css);
      }

      // Direct tail: non-logical, non-user-action pseudo-classes are invalid.
      for (const css of [
        '::before:defined',
        '::before:dir(ltr)',
        '::before:lang(en)',
        '::before:any-link',
        '::before:scope',
        '::before:has(*)',
        '::before:enabled',
        '::before:root',
        '::before:nth-of-type(1)',
      ]) {
        expectInvalidSelector(css);
      }

      // Direct tail: ordinary simple selectors cannot follow the pseudo-element.
      for (const css of [
        '::before.foo',
        '::before#id',
        '::before[hidden]',
        '::before*',
      ]) {
        expectInvalidSelector(css);
      }

      // Forgiving logical arguments inherit pseudo-element-tail restrictions.
      // Invalid ordinary selector arms are dropped, leaving only valid tail pseudos.
      expectForgivingTailIsNames(
        '::before:is(*, div, #id, .foo, [hidden], :hover)',
        ['hover'],
      );

      expectForgivingTailIsNames(
        '::before:is(:defined, :dir(ltr), :lang(en), :has(*), :active)',
        ['active'],
      );

      // Complex arms are invalid in the pseudo-element tail, even when their first
      // compound starts with an otherwise-valid user-action pseudo-class.
      expectForgivingTailIsNames(
        '::before:is(:hover > .x, :active + .y, :focus)',
        ['focus'],
      );

      // Nested forgiving pseudos also inherit the pseudo-element-tail restrictions.
      // The inner :where(*, .foo, :hover) should keep only :hover.
      expect(expectComplexSelector('::before:is(:where(*, .foo, :hover), :active)')).toMatchObject({
        parts: [
          pseudoElementPart(null, 'before', [
            pseudoClass('is', {
              kind: PseudoArgumentKind.ForgivingSelectorList,
              selectors: selectorList([
                {
                  parts: [
                    realPart(null, compound(null, [
                      pseudoClass('where', {
                        kind: PseudoArgumentKind.ForgivingSelectorList,
                        selectors: selectorList([
                          {
                            parts: [
                              realPart(null, compound(null, [
                                pseudoClass('hover'),
                              ])),
                            ],
                          },
                        ]),
                      }),
                    ])),
                  ],
                },
                {
                  parts: [
                    realPart(null, compound(null, [
                      pseudoClass('active'),
                    ])),
                  ],
                },
              ]),
            }),
          ]),
        ],
      });

      // :not is strict. Contextual invalidity inside :not poisons the whole selector.
      for (const css of [
        '::before:not(.foo)',
        '::before:not(#id)',
        '::before:not([hidden])',
        '::before:not(div)',
        '::before:not(*)',
        '::before:not(:defined)',
        '::before:not(:has(*))',
        '::before:not(:hover > .x)',
        '::before:not(:not(.foo))',
      ]) {
        expectInvalidSelector(css);
      }

      // But :not() may contain a forgiving logical pseudo whose own bad arms
      // have been dropped under the inherited pseudo-element-tail restrictions.
      for (const css of [
        '::before:not(:is(.foo))',
        '::before:not(:where(.foo, #id, [hidden]))',
        '::before:not(:is(:has(*), div, .foo))',
        '::before:not(:is(:hover))',
        '::before:not(:where(:focus-visible))',
      ]) {
        expectValidSelector(css);
      }
    });
  });

  describe('element-backed pseudo-elements', () => {
    it('allows all pseudo-classes after element-backed pseudo-elements', () => {
      for (const css of [
        '::file-selector-button:disabled',
        '::file-selector-button:first-child',
        '::file-selector-button:scope',
        '::details-content:open',
        '::details-content:empty',
        '::part(label):disabled',
        '::part(label):first-child',
        '::part(label):scope',
      ]) {
        expectValidSelector(css);
      }
    });

    it('treats element-backed pseudo-elements like type selectors in selector arguments', () => {
      for (const css of [
        '::file-selector-button:not(.missing)',
        '::file-selector-button:has(*)',
        '::details-content:not([open])',
        '::details-content:has(*)',
        '::part(label):not(.container > .label)',
        '::part(label):not(.disabled + .label)',
        '::part(label):not(:not(.label))',
        '::part(label):has(> .child)',
        '::part(label):has(+ .sibling)',
        '::part(label):host(.label)',
        '::part(label):host-context(.label)',
        '::part(label)::slotted(.label)',
        '::part(label):nth-child(2n of .label)',
      ]) {
        expectValidSelector(css);
      }
    });

    it('retains forgiving complex selector arms after element-backed pseudo-elements', () => {
      expect(expectComplexSelector('::part(label):is(.container > .label)')).toMatchObject({
        parts: [
          pseudoElementPart(null, 'part', [
            pseudoClass('is', {
              kind: PseudoArgumentKind.ForgivingSelectorList,
              selectors: selectorList([
                {
                  parts: [
                    realClassPart(null, 'container'),
                    realClassPart('>', 'label'),
                  ],
                },
              ]),
            }),
          ], {
            kind: PseudoArgumentKind.PartNameList,
            names: ['label'],
          }),
        ],
      });
    });

    it('preserves namespace declarations in element-backed selector arguments', () => {
      expectValidSelector('::part(label):not(svg|button)', namespaceContext);
      expectInvalidSelector('::part(label):not(svg|button)');
    });
  });

  describe('sub-pseudo-element chains', () => {
    it('accepts pseudo-element chains with defined origins', () => {
      for (const css of [
        // Explicit CSS Pseudo sub-pseudo-elements.
        '::before::marker',
        '::after::marker',
        '::first-letter::prefix',
        '::first-letter::suffix',

        // All pseudo-elements are syntactically allowed after element-backed pseudos.
        '::file-selector-button::before',
        '::details-content::before',
        '::part(foo)::before',
        '::part(foo)::part(bar)',

        // ::slotted() allows tree-abiding pseudo-elements.
        '::slotted(*)::before',

        // Each link in a longer chain is validated against its immediate origin.
        '::part(foo)::before::marker',
      ]) {
        expectValidSelector(css);
      }
    });

    it('rejects pseudo-element chains without defined origins', () => {
      for (const css of [
        // ::prefix and ::suffix require a valid pseudo-element origin.
        '::prefix',
        '::suffix',

        // Ordinary tree-abiding and highlight pseudo-elements do not accept
        // arbitrary sub-pseudo-elements.
        '::before::before',
        '::before::prefix',
        '::marker::marker',
        '::marker::before',
        '::first-letter::marker',
        '::selection::before',
        '::highlight(foo)::before',

        // ::slotted() only allows tree-abiding pseudo-elements.
        '::slotted(*)::selection',

        // The immediately preceding pseudo-element controls each chain link.
        '::part(foo)::marker::before',
      ]) {
        expectInvalidSelector(css);
      }
    });
  });

  describe('combinators after pseudo-elements', () => {
    it('rejects combinators after pseudo-elements without internal structure', () => {
      // Baseline: combinators before the pseudo-element are still ordinary selector structure.
      expectValidSelector('.foo ::before');

      // Ordinary generated pseudo-elements cannot be followed by combinators.
      for (const css of [
        '::before div',
        '::before > div',
        '::before + div',
        '::before ~ div',
        '.foo::before span',
        '.foo::before > span',
        '.foo::before + span',
        '.foo::before ~ span',
      ]) {
        expectInvalidSelector(css);
      }

      // Tail pseudo-classes do not reset the pseudo-element combinator restriction.
      for (const css of [
        '::before:hover span',
        '::before:hover > span',
        '::before:is(:hover) span',
        '::before:not(:is(.foo)) > span',
      ]) {
        expectInvalidSelector(css);
      }

      // Pseudo-element chains are still pseudo-element-ending units.
      for (const css of [
        '::before::marker > span',
        '::first-letter::prefix > span',
        '::first-letter::suffix > span',
        '::part(foo) > span',
        '::slotted(*) > span',
      ]) {
        expectInvalidSelector(css);
      }

      // Strict selector lists are poisoned by an invalid pseudo-element-combinator arm.
      expectInvalidSelector('::before > div, .ok');
    });

    it('applies pseudo-element combinator restrictions without leaking context', () => {
      // Trailing trivia after a pseudo-element is not a descendant combinator.
      expectValidSelector('::before ');
      expectValidSelector('.foo ::before ');

      // Explicit trailing combinators after a pseudo-element are still invalid.
      for (const css of [
        '::before >',
        '::before +',
        '::before ~',
        '::before ||',
      ]) {
        expectInvalidSelector(css);
      }

      // The previous-unit marker must not leak across selector-list arms.
      expectValidSelector('::before, div span');
      expectValidSelector('::before, .foo ::after');
      expectValidSelector('.foo ::before, div span');
      expectValidSelector('.foo ::before, div > span');

      // A combinator before a pseudo-element is allowed; after it is not.
      expectValidSelector('div > ::before');
      expectInvalidSelector('div > ::before > span');
      for (const css of [
        'div > ::before span',
        'div > ::before > span',
        'div > ::before + span',
        'div > ::before ~ span',
        'div > ::before || span',
        '::before || div',
        '.foo::before || span',
      ]) {
        expectInvalidSelector(css);
      }

      // Pseudo-element chains still count as ending in a pseudo-element.
      expectInvalidSelector('div > ::before::marker > span');

      // Forgiving logical pseudos drop arms invalid in pseudo-element-tail context.
      expectValidSelector('::before:is(::after > span, :hover)');
      expectValidSelector('::before:where(::after > span, :focus)');

      // Strict :not is poisoned by the same invalid arm.
      expectInvalidSelector('::before:not(::after > span)');
    });
  });
});

describe('contextual selector restrictions', () => {
  it('does not carry sub-pseudo-element origins into selector arguments', () => {
    expectInvalidSelector('::part(foo)::part(bar):has(::prefix)');
  });

  it('does not allow pseudo-compounds where compound selectors are required', () => {
    expectInvalidSelector(':host(::before)');
    expectInvalidSelector(':host(.foo::before)');
  });

  it.each([
    '::slotted(:not(.a > .b))',
    ':host(:not(.a > .b))',
    ':host-context(:not(.a > .b))',
    '::slotted(:has(.b))',
    '::slotted(:nth-child(2n of .a > .b))',
    '::slotted(:nth-last-child(2n of .a .b))',
  ])('rejects %s when a nested argument violates its compound-only context', (css) => {
    expectInvalidSelector(css);
  });

  it('allows a compound :nth-child() of selector inside ::slotted()', () => {
    expectValidSelector('::slotted(:nth-child(2n of .a.b))');
  });

  it('drops complex forgiving arms under compound-only shadow arguments', () => {
    expect(expectComplexSelector('::slotted(:is(.a > .b, .a.b))')).toMatchObject({
      parts: [
        pseudoElementPart(null, 'slotted', [], {
          kind: PseudoArgumentKind.CompoundSelector,
          selector: compound(null, [
            pseudoClass('is', {
              kind: PseudoArgumentKind.ForgivingSelectorList,
              selectors: selectorList([
                {
                  parts: [
                    realPart(null, compound(null, [
                      classSelector('a'),
                      classSelector('b'),
                    ])),
                  ],
                },
              ]),
            }),
          ]),
        }),
      ],
    });
  });

  it.each([
    '::slotted(:is(.a > .b))',
    '::slotted(:where(.a > .b))',
    ':host(:is(.a > .b))',
    ':host(:where(.a > .b))',
    ':host-context(:is(.a > .b))',
    ':host-context(:where(.a > .b))',
  ])('accepts %s after restricted forgiving arms are dropped', (css) => {
    expectValidSelector(css);
  });
});

describe('AST representation', () => {
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
});

describe('specificity', () => {
  it('computes the simple selector columns', () => {
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

  it('uses maximum specificity for selector lists', () => {
    const result = expectComplexSelectorList('*, div, .foo, #bar');

    expect(result.specificity).toEqual(specificity(1, 0, 0));
    expect(result.arms.map((arm) => arm.specificity)).toEqual([
      specificity(0, 0, 0),
      specificity(0, 0, 1),
      specificity(0, 1, 0),
      specificity(1, 0, 0),
    ]);
  });

  it('implements special pseudo-class specificity rules', () => {
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

  it('computes specificity for a complex selector list', () => {
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

  it('computes specificity for shadow and highlight pseudo-elements', () => {
    expect(expectComplexSelector('::highlight(foo)').specificity)
      .toEqual(specificity(0, 0, 1));

    expect(expectComplexSelector('::part(foo active)').specificity)
      .toEqual(specificity(0, 0, 1));

    expect(expectComplexSelector('::slotted(.foo)').specificity)
      .toEqual(specificity(0, 1, 1));
  });
});
