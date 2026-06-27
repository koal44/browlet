import { describe, expect, it } from 'vitest';
import { ComponentCursor } from '../../../src/stylelet/parser/component-cursor';
import { type ComplexSelector, type ComplexSelectorList, tryParseSelectorList } from '../../../src/stylelet/parser/selector';
import { consumeComponentTrivia, parseListOfComponentValues } from '../../../src/stylelet/parser/syntax';

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

function expectComplexSelectorList(css: string): ComplexSelector[] {
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

    expect(result, `Expected exactly one selector for: ${css}`).toHaveLength(1);

    return result[0];
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
  type: 'id-selector',
  name,
});

const classSelector = (name: string) => ({
  type: 'class-selector',
  name,
});

const attrName = (name: string, namespace: unknown = null) => ({
  name,
  namespace,
});

const attrSelector = (name: string, rest: object = {}) => ({
  type: 'attribute-selector',
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

describe('selector parser basics', () => {
  it('rejects an empty selector list', () => {
    expectInvalidSelector('');
  });

  it('parses a type selector', () => {
    expect(expectComplexSelector('div')).toMatchObject({
      type: 'complex-selector',
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
