import { describe, expect, it } from 'vitest';
import { ComponentCursor } from '../../../src/stylelet/parser/component-cursor';
import { tryParseSelectorList } from '../../../src/stylelet/parser/selector';
import { consumeComponentTrivia, parseListOfComponentValues } from '../../../src/stylelet/parser/syntax';

const cursor = (css: string): ComponentCursor =>
  new ComponentCursor(parseListOfComponentValues(css));

type SelectorListResult = NonNullable<ReturnType<typeof tryParseSelectorList>>;
type SelectorResult = SelectorListResult[number];

function parseFull(css: string): SelectorListResult | null {
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

function expectSelectorList(css: string): SelectorListResult {
  try {
    const result = parseFull(css);

    expect(result, `Expected selector list to parse: ${css}`).not.toBeNull();

    return result as SelectorListResult;
  } catch (error) {
    rethrowFromCaller(error, expectSelectorList);
  }
}

function expectOneSelector(css: string): SelectorResult {
  try {
    const result = expectSelectorList(css);

    expect(result, `Expected exactly one selector for: ${css}`).toHaveLength(1);

    return result[0];
  } catch (error) {
    rethrowFromCaller(error, expectOneSelector);
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

describe('selector parser basics', () => {
  it('rejects an empty selector list', () => {
    expectInvalidSelector('');
  });

  it('parses a type selector', () => {
    expect(expectOneSelector('div')).toMatchObject({
      type: 'complex-selector',
      head: {
        compound: {
          typeSelector: {
            name: 'div',
            namespace: null,
          },
          subclasses: [],
        },
        pseudoCompounds: [],
      },
      tail: [],
    });
  });

  it('parses a universal selector', () => {
    expect(expectOneSelector('*')).toMatchObject({
      head: {
        compound: {
          typeSelector: {
            name: '*',
            namespace: null,
          },
          subclasses: [],
        },
      },
      tail: [],
    });
  });

  it('parses an id selector', () => {
    expect(expectOneSelector('#foo')).toMatchObject({
      head: {
        compound: {
          typeSelector: null,
          subclasses: [
            {
              type: 'id-selector',
              name: 'foo',
            },
          ],
        },
      },
      tail: [],
    });
  });

  it('parses a class selector', () => {
    expect(expectOneSelector('.foo')).toMatchObject({
      head: {
        compound: {
          typeSelector: null,
          subclasses: [
            {
              type: 'class-selector',
              name: 'foo',
            },
          ],
        },
      },
      tail: [],
    });
  });

  it('parses a compound selector with type, id, and class selectors', () => {
    expect(expectOneSelector('div#main.foo.bar')).toMatchObject({
      head: {
        compound: {
          typeSelector: {
            name: 'div',
          },
          subclasses: [
            {
              type: 'id-selector',
              name: 'main',
            },
            {
              type: 'class-selector',
              name: 'foo',
            },
            {
              type: 'class-selector',
              name: 'bar',
            },
          ],
        },
      },
      tail: [],
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
    expect(expectOneSelector('svg|circle')).toMatchObject({
      head: {
        compound: {
          typeSelector: {
            namespace: {
              prefix: 'svg',
            },
            name: 'circle',
          },
        },
      },
    });
  });

  it('parses an empty namespace prefix', () => {
    expect(expectOneSelector('|circle')).toMatchObject({
      head: {
        compound: {
          typeSelector: {
            namespace: {
              prefix: null,
            },
            name: 'circle',
          },
        },
      },
    });
  });

  it('parses a wildcard namespace prefix', () => {
    expect(expectOneSelector('*|circle')).toMatchObject({
      head: {
        compound: {
          typeSelector: {
            namespace: {
              prefix: '*',
            },
            name: 'circle',
          },
        },
      },
    });
  });

  it('parses a namespace-qualified universal selector', () => {
    expect(expectOneSelector('svg|*')).toMatchObject({
      head: {
        compound: {
          typeSelector: {
            namespace: {
              prefix: 'svg',
            },
            name: '*',
          },
        },
      },
    });
  });

  it('parses a wildcard namespace universal selector', () => {
    expect(expectOneSelector('*|*')).toMatchObject({
      head: {
        compound: {
          typeSelector: {
            namespace: {
              prefix: '*',
            },
            name: '*',
          },
        },
      },
    });
  });

  it('rejects a dangling namespace separator', () => {
    expectInvalidSelector('svg|');
  });
});

describe('selector parser attribute selectors', () => {
  it('parses an existence attribute selector', () => {
    expect(expectOneSelector('[href]')).toMatchObject({
      head: {
        compound: {
          subclasses: [
            {
              type: 'attribute-selector',
              name: {
                name: 'href',
                namespace: null,
              },
              matcher: null,
              value: null,
              modifier: null,
            },
          ],
        },
      },
    });
  });

  it('parses an exact-match attribute selector with ident value', () => {
    expect(expectOneSelector('[href=example]')).toMatchObject({
      head: {
        compound: {
          subclasses: [
            {
              type: 'attribute-selector',
              name: {
                name: 'href',
              },
              matcher: '=',
              value: {
                type: 'ident',
                value: 'example',
              },
              modifier: null,
            },
          ],
        },
      },
    });
  });

  it('parses an exact-match attribute selector with string value', () => {
    expect(expectOneSelector('[href="example"]')).toMatchObject({
      head: {
        compound: {
          subclasses: [
            {
              type: 'attribute-selector',
              name: {
                name: 'href',
              },
              matcher: '=',
              value: {
                type: 'string',
                value: 'example',
              },
              modifier: null,
            },
          ],
        },
      },
    });
  });

  it('parses attribute selector whitespace around components', () => {
    expect(expectOneSelector('[ href = example ]')).toMatchObject({
      head: {
        compound: {
          subclasses: [
            {
              type: 'attribute-selector',
              name: {
                name: 'href',
              },
              matcher: '=',
              value: {
                type: 'ident',
                value: 'example',
              },
            },
          ],
        },
      },
    });
  });

  it('parses all attribute matcher prefixes', () => {
    // // const c = cursor('[a|=b]');
    // const comp = parseListOfComponentValues('[a|=b]');
    // throw new Error(JSON.stringify(comp, null, 2));
    expect(expectOneSelector('[a~=b]')).toMatchObject({
      head: {
        compound: {
          subclasses: [
            {
              matcher: '~=',
            },
          ],
        },
      },
    });

    expect(expectOneSelector('[a|=b]')).toMatchObject({
      head: {
        compound: {
          subclasses: [
            {
              matcher: '|=',
            },
          ],
        },
      },
    });

    expect(expectOneSelector('[a^=b]')).toMatchObject({
      head: {
        compound: {
          subclasses: [
            {
              matcher: '^=',
            },
          ],
        },
      },
    });

    expect(expectOneSelector('[a$=b]')).toMatchObject({
      head: {
        compound: {
          subclasses: [
            {
              matcher: '$=',
            },
          ],
        },
      },
    });

    expect(expectOneSelector('[a*=b]')).toMatchObject({
      head: {
        compound: {
          subclasses: [
            {
              matcher: '*=',
            },
          ],
        },
      },
    });
  });

  it('parses an ASCII case-insensitive attribute modifier', () => {
    expect(expectOneSelector('[href=example i]')).toMatchObject({
      head: {
        compound: {
          subclasses: [
            {
              matcher: '=',
              value: {
                type: 'ident',
                value: 'example',
              },
              modifier: 'i',
            },
          ],
        },
      },
    });
  });

  it('parses an ASCII case-sensitive attribute modifier', () => {
    expect(expectOneSelector('[href=example s]')).toMatchObject({
      head: {
        compound: {
          subclasses: [
            {
              matcher: '=',
              value: {
                type: 'ident',
                value: 'example',
              },
              modifier: 's',
            },
          ],
        },
      },
    });
  });

  it('parses a namespaced attribute name', () => {
    expect(expectOneSelector('[svg|href=value]')).toMatchObject({
      head: {
        compound: {
          subclasses: [
            {
              type: 'attribute-selector',
              name: {
                namespace: {
                  prefix: 'svg',
                },
                name: 'href',
              },
              matcher: '=',
            },
          ],
        },
      },
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
    expect(expectOneSelector('div span')).toMatchObject({
      head: {
        compound: {
          typeSelector: {
            name: 'div',
          },
        },
      },
      tail: [
        {
          combinator: ' ',
          unit: {
            compound: {
              typeSelector: {
                name: 'span',
              },
            },
          },
        },
      ],
    });
  });

  it('parses a child combinator with whitespace', () => {
    expect(expectOneSelector('div > span')).toMatchObject({
      tail: [
        {
          combinator: '>',
          unit: {
            compound: {
              typeSelector: {
                name: 'span',
              },
            },
          },
        },
      ],
    });
  });

  it('parses a child combinator without whitespace', () => {
    expect(expectOneSelector('div>span')).toMatchObject({
      tail: [
        {
          combinator: '>',
        },
      ],
    });
  });

  it('parses adjacent and subsequent sibling combinators', () => {
    expect(expectOneSelector('h1 + p')).toMatchObject({
      tail: [
        {
          combinator: '+',
          unit: {
            compound: {
              typeSelector: {
                name: 'p',
              },
            },
          },
        },
      ],
    });

    expect(expectOneSelector('h1 ~ p')).toMatchObject({
      tail: [
        {
          combinator: '~',
          unit: {
            compound: {
              typeSelector: {
                name: 'p',
              },
            },
          },
        },
      ],
    });
  });

  it('parses the column combinator', () => {
    expect(expectOneSelector('col || td')).toMatchObject({
      tail: [
        {
          combinator: '||',
          unit: {
            compound: {
              typeSelector: {
                name: 'td',
              },
            },
          },
        },
      ],
    });
  });

  it('parses a longer complex selector chain', () => {
    expect(expectOneSelector('main > section .card + .card')).toMatchObject({
      head: {
        compound: {
          typeSelector: {
            name: 'main',
          },
        },
      },
      tail: [
        {
          combinator: '>',
          unit: {
            compound: {
              typeSelector: {
                name: 'section',
              },
            },
          },
        },
        {
          combinator: ' ',
          unit: {
            compound: {
              subclasses: [
                {
                  type: 'class-selector',
                  name: 'card',
                },
              ],
            },
          },
        },
        {
          combinator: '+',
          unit: {
            compound: {
              subclasses: [
                {
                  type: 'class-selector',
                  name: 'card',
                },
              ],
            },
          },
        },
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

describe('selector parser selector lists', () => {
  it('parses a comma-separated selector list', () => {
    const result = expectSelectorList('div, .foo, #bar');

    expect(result).toHaveLength(3);

    expect(result[0]).toMatchObject({
      head: {
        compound: {
          typeSelector: {
            name: 'div',
          },
        },
      },
    });

    expect(result[1]).toMatchObject({
      head: {
        compound: {
          subclasses: [
            {
              type: 'class-selector',
              name: 'foo',
            },
          ],
        },
      },
    });

    expect(result[2]).toMatchObject({
      head: {
        compound: {
          subclasses: [
            {
              type: 'id-selector',
              name: 'bar',
            },
          ],
        },
      },
    });
  });

  it('allows whitespace around selector-list commas', () => {
    const result = expectSelectorList('div ,  span');

    expect(result).toHaveLength(2);
  });

  it('rejects a leading comma', () => {
    expectInvalidSelector(', div');
  });

  it('rejects a trailing comma', () => {
    expectInvalidSelector('div,');
  });

  it('rejects an empty selector between commas', () => {
    expectInvalidSelector('div,, span');
  });
});

describe('selector parser pseudo selectors', () => {
  it('parses a pseudo-class selector', () => {
    expect(expectOneSelector(':hover')).toMatchObject({
      head: {
        compound: {
          typeSelector: null,
          subclasses: [
            {
              type: 'pseudo-class-selector',
              name: 'hover',
              value: null,
            },
          ],
        },
        pseudoCompounds: [],
      },
      tail: [],
    });
  });

  it('parses a functional pseudo-class selector and preserves its component values', () => {
    const selector = expectOneSelector(':nth-child(2n + 1)');

    expect(selector).toMatchObject({
      head: {
        compound: {
          subclasses: [
            {
              type: 'pseudo-class-selector',
              name: 'nth-child',
            },
          ],
        },
      },
    });

    expect(selector.head.compound?.subclasses[0]).toHaveProperty('value');
    // expect(selector.head.compound?.subclasses[0]).toMatchObject({
    //   value: expect.any(Array),
    // });
  });

  it('parses a selector-list pseudo-class as a preserved function value', () => {
    const selector = expectOneSelector(':is(.foo, #bar)');

    expect(selector).toMatchObject({
      head: {
        compound: {
          subclasses: [
            {
              type: 'pseudo-class-selector',
              name: 'is',
              // value: expect.any(Array),
            },
          ],
        },
      },
    });
  });

  it('does not parse legacy pseudo-element names as pseudo-classes', () => {
    expect(expectOneSelector(':before')).toMatchObject({
      head: {
        compound: null,
        pseudoCompounds: [
          {
            pseudoElement: {
              name: 'before',
              legacy: true,
            },
            pseudoClasses: [],
          },
        ],
      },
      tail: [],
    });
  });

  it('parses a double-colon pseudo-element', () => {
    expect(expectOneSelector('::before')).toMatchObject({
      head: {
        compound: null,
        pseudoCompounds: [
          {
            pseudoElement: {
              name: 'before',
              legacy: false,
            },
            pseudoClasses: [],
          },
        ],
      },
      tail: [],
    });
  });

  it('parses a functional pseudo-element', () => {
    expect(expectOneSelector('::part(button)')).toMatchObject({
      head: {
        compound: null,
        pseudoCompounds: [
          {
            pseudoElement: {
              name: 'part',
              legacy: false,
              // value: expect.any(Array),
            },
            pseudoClasses: [],
          },
        ],
      },
      tail: [],
    });
  });

  it('parses pseudo-classes after a pseudo-element', () => {
    expect(expectOneSelector('::before:hover')).toMatchObject({
      head: {
        compound: null,
        pseudoCompounds: [
          {
            pseudoElement: {
              name: 'before',
            },
            pseudoClasses: [
              {
                name: 'hover',
              },
            ],
          },
        ],
      },
      tail: [],
    });
  });

  it('parses compound selector followed by pseudo-element', () => {
    expect(expectOneSelector('button.primary::before')).toMatchObject({
      head: {
        compound: {
          typeSelector: {
            name: 'button',
          },
          subclasses: [
            {
              type: 'class-selector',
              name: 'primary',
            },
          ],
        },
        pseudoCompounds: [
          {
            pseudoElement: {
              name: 'before',
            },
          },
        ],
      },
      tail: [],
    });
  });

  it('rejects a class selector after a pseudo-element without a combinator', () => {
    expectInvalidSelector('::before.foo');
  });
});

describe('selector parser mixed selectors', () => {
  it('parses a realistic compound selector', () => {
    expect(expectOneSelector('section#main.content[data-state=open]:hover')).toMatchObject({
      head: {
        compound: {
          typeSelector: {
            name: 'section',
          },
          subclasses: [
            {
              type: 'id-selector',
              name: 'main',
            },
            {
              type: 'class-selector',
              name: 'content',
            },
            {
              type: 'attribute-selector',
              name: {
                name: 'data-state',
              },
              matcher: '=',
              value: {
                type: 'ident',
                value: 'open',
              },
            },
            {
              type: 'pseudo-class-selector',
              name: 'hover',
            },
          ],
        },
        pseudoCompounds: [],
      },
      tail: [],
    });
  });

  it('parses a realistic selector list', () => {
    const result = expectSelectorList(
      'main > section.card[data-active=true], nav a:hover, button::before',
    );

    expect(result).toHaveLength(3);

    expect(result[0]).toMatchObject({
      head: {
        compound: {
          typeSelector: {
            name: 'main',
          },
        },
      },
      tail: [
        {
          combinator: '>',
          unit: {
            compound: {
              typeSelector: {
                name: 'section',
              },
              subclasses: [
                {
                  type: 'class-selector',
                  name: 'card',
                },
                {
                  type: 'attribute-selector',
                  name: {
                    name: 'data-active',
                  },
                },
              ],
            },
          },
        },
      ],
    });

    expect(result[1]).toMatchObject({
      head: {
        compound: {
          typeSelector: {
            name: 'nav',
          },
        },
      },
      tail: [
        {
          combinator: ' ',
          unit: {
            compound: {
              typeSelector: {
                name: 'a',
              },
              subclasses: [
                {
                  type: 'pseudo-class-selector',
                  name: 'hover',
                },
              ],
            },
          },
        },
      ],
    });

    expect(result[2]).toMatchObject({
      head: {
        compound: {
          typeSelector: {
            name: 'button',
          },
        },
        pseudoCompounds: [
          {
            pseudoElement: {
              name: 'before',
            },
          },
        ],
      },
    });
  });
});
