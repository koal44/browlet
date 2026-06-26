import { asciiLower } from '../../utils/css';
import {
  any,
  map, one, oneOf, opt, repeatComma, requireAny, sequence, withComponentTrivia, type TryValueParser,
} from './component';
import { ComponentCursor } from './component-cursor';
import type { BracketBlock, ComponentValue, FunctionBlock } from './syntax';
import {
  BlockKind, consumeComponentTrivia, isBlockKind, isDelimToken, isFunctionBlock, isIdentToken, isIdentTokenWithValue, isTokenKind,
} from './syntax';
import type { HashToken, StringToken } from './tokens';
import { HashTokenFlag, type IdentToken, TokenKind } from './tokens';

/**
 * <selector-list> = <complex-selector-list>
 */
export type SelectorList = ComplexSelectorList;

export function tryParseSelectorList(c: ComponentCursor): SelectorList | null {
  return parseSelectorList(c);
}

const parseSelectorList: TryValueParser<SelectorList> =
  tryParseComplexSelectorList;

/**
 * <complex-selector-list> = <complex-selector>#
 */
export type ComplexSelectorList = ComplexSelector[];

function tryParseComplexSelectorList(c: ComponentCursor): ComplexSelectorList | null {
  return parseComplexSelectorList(c);
}

const parseComplexSelectorList: TryValueParser<ComplexSelectorList> =
  repeatComma(tryParseComplexSelector);

/**
 * <complex-real-selector-list> = <complex-real-selector>#
 */
export type ComplexRealSelectorList = ComplexRealSelector[];

export function tryParseComplexRealSelectorList(c: ComponentCursor): ComplexRealSelectorList | null {
  return parseComplexRealSelectorList(c);
}

const parseComplexRealSelectorList: TryValueParser<ComplexRealSelectorList> =
  repeatComma(tryParseComplexRealSelector);

/**
 * <compound-selector-list> = <compound-selector>#
 */
export type CompoundSelectorList = CompoundSelector[];

export function tryParseCompoundSelectorList(c: ComponentCursor): CompoundSelectorList | null {
  return parseCompoundSelectorList(c);
}

const parseCompoundSelectorList: TryValueParser<CompoundSelectorList> =
  repeatComma(tryParseCompoundSelector);

/**
 * <simple-selector-list> = <simple-selector>#
 */
export type SimpleSelectorList = SimpleSelector[];

export function tryParseSimpleSelectorList(c: ComponentCursor): SimpleSelectorList | null {
  return parseSimpleSelectorList(c);
}

const parseSimpleSelectorList: TryValueParser<SimpleSelectorList> =
  repeatComma(tryParseSimpleSelector);

/**
 * <relative-selector-list> = <relative-selector>#
 */
export type RelativeSelectorList = RelativeSelector[];

export function tryParseRelativeSelectorList(c: ComponentCursor): RelativeSelectorList | null {
  return parseRelativeSelectorList(c);
}

const parseRelativeSelectorList: TryValueParser<RelativeSelectorList> =
  repeatComma(tryParseRelativeSelector);

/**
 * <relative-real-selector-list> = <relative-real-selector>#
 */
export type RelativeRealSelectorList = RelativeRealSelector[];

export function tryParseRelativeRealSelectorList(c: ComponentCursor): RelativeRealSelectorList | null {
  return parseRelativeRealSelectorList(c);
}

const parseRelativeRealSelectorList: TryValueParser<RelativeRealSelectorList> =
  repeatComma(tryParseRelativeRealSelector);


/**
 * <complex-selector> =
 *   <complex-selector-unit> [ <combinator>? <complex-selector-unit> ]*
 */
export type ComplexSelector = {
  type: 'complex-selector';
  head: ComplexSelectorUnit;
  tail: {
    combinator: Combinator;
    unit: ComplexSelectorUnit;
  }[];
};

function tryParseComplexSelector(c: ComponentCursor): ComplexSelector | null {
  return parseComplexSelector(c);
}

const parseComplexSelector: TryValueParser<ComplexSelector> = map(
  sequence(
    one(tryParseComplexSelectorUnit),
    any(
      map(
        sequence(
          one(tryParseCombinator),
          one(tryParseComplexSelectorUnit),
        ),
        ([[combinator], [unit]]) => ({
          combinator,
          unit,
        }),
      )
    ),
  ),
  ([[head], tail]): ComplexSelector => ({
    type: 'complex-selector',
    head,
    tail,
  }),
);

/**
 * <complex-selector-unit> =
 *   [ <compound-selector>? <pseudo-compound-selector>* ]!
 */
export type ComplexSelectorUnit = {
  type: 'complex-selector-unit';
  compound: CompoundSelector | null;
  pseudoCompounds: PseudoCompoundSelector[];
};

function tryParseComplexSelectorUnit(c: ComponentCursor): ComplexSelectorUnit | null {
  return parseComplexSelectorUnit(c);
}

const parseComplexSelectorUnit: TryValueParser<ComplexSelectorUnit> = map(
  requireAny(
    sequence(
      opt(tryParseCompoundSelector),
      any(tryParsePseudoCompoundSelector),
    ),
  ),
  ([compound, pseudoCompounds]): ComplexSelectorUnit => ({
    type: 'complex-selector-unit',
    compound: compound[0] ?? null,
    pseudoCompounds,
  }),
);

/**
 * <complex-real-selector> =
 *   <compound-selector> [ <combinator>? <compound-selector> ]*
 */
export type ComplexRealSelector = {
  type: 'complex-real-selector';
  head: CompoundSelector;
  tail: {
    combinator: Combinator;
    compound: CompoundSelector;
  }[];
};

function tryParseComplexRealSelector(c: ComponentCursor): ComplexRealSelector | null {
  return parseComplexRealSelector(c);
}

const parseComplexRealSelector: TryValueParser<ComplexRealSelector> = map(
  sequence(
    one(tryParseCompoundSelector),
    any(
      map(
        sequence(
          one(tryParseCombinator),
          one(tryParseCompoundSelector),
        ),
        ([[combinator], [compound]]) => ({
          combinator,
          compound,
        }),
      ),
    ),
  ),
  ([[head], tail]): ComplexRealSelector => ({
    type: 'complex-real-selector',
    head,
    tail,
  }),
);

/**
 * <relative-selector> = <combinator>? <complex-selector>
 */
export type RelativeSelector = {
  type: 'relative-selector';
  combinator: Combinator | null;
  selector: ComplexSelector;
};

export function tryParseRelativeSelector(c: ComponentCursor): RelativeSelector | null {
  return parseRelativeSelector(c);
}

const parseRelativeSelector: TryValueParser<RelativeSelector> = map(
  sequence(
    opt(tryParseCombinator),
    one(tryParseComplexSelector),
  ),
  ([combinator, [selector]]): RelativeSelector => ({
    type: 'relative-selector',
    combinator: combinator[0] ?? null,
    selector,
  }),
);

/**
 * <relative-real-selector> = <combinator>? <complex-real-selector>
 */
export type RelativeRealSelector = {
  type: 'relative-real-selector';
  combinator: Combinator | null;
  selector: ComplexRealSelector;
};

export function tryParseRelativeRealSelector(c: ComponentCursor): RelativeRealSelector | null {
  return parseRelativeRealSelector(c);
}

const parseRelativeRealSelector: TryValueParser<RelativeRealSelector> = map(
  sequence(
    opt(tryParseCombinator),
    one(tryParseComplexRealSelector),
  ),
  ([combinator, [selector]]): RelativeRealSelector => ({
    type: 'relative-real-selector',
    combinator: combinator[0] ?? null,
    selector,
  }),
);

/**
 * <compound-selector> = [ <type-selector>? <subclass-selector>* ]!
 */
export type CompoundSelector = {
  type: 'compound-selector';
  typeSelector: TypeSelector | null;
  subclasses: SubclassSelector[];
};

function tryParseCompoundSelector(c: ComponentCursor): CompoundSelector | null {
  return parseCompoundSelector(c);
}

const parseCompoundSelector: TryValueParser<CompoundSelector> = map(
  requireAny(
    sequence(
      opt(tryParseTypeSelector),
      any(tryParseSubclassSelector),
    ),
  ),
  ([typeSelector, subclasses]): CompoundSelector => ({
    type: 'compound-selector',
    typeSelector: typeSelector[0] ?? null,
    subclasses,
  }),
);

/**
 * <pseudo-compound-selector> =
 *   <pseudo-element-selector> <pseudo-class-selector>*
 */
export type PseudoCompoundSelector = {
  type: 'pseudo-compound-selector';
  pseudoElement: PseudoElementSelector;
  pseudoClasses: PseudoClassSelector[];
};

function tryParsePseudoCompoundSelector(c: ComponentCursor): PseudoCompoundSelector | null {
  return parsePseudoCompoundSelector(c);
}

const parsePseudoCompoundSelector: TryValueParser<PseudoCompoundSelector> = map(
  sequence(
    one(tryParsePseudoElementSelector),
    any(tryParsePseudoClassSelector),
  ),
  ([[pseudoElement], pseudoClasses]): PseudoCompoundSelector => ({
    type: 'pseudo-compound-selector',
    pseudoElement,
    pseudoClasses,
  }),
);

/**
 * <simple-selector> = <type-selector> | <subclass-selector>
 */
export type SimpleSelector = TypeSelector | SubclassSelector;

function tryParseSimpleSelector(c: ComponentCursor): SimpleSelector | null {
  return parseSimpleSelector(c);
}

const parseSimpleSelector: TryValueParser<SimpleSelector> = oneOf(
  tryParseTypeSelector,
  tryParseSubclassSelector,
);

/**
 * Parser-level selector combinator.
 *
 * The spec's <combinator> production is only:
 *   '>' | '+' | '~' | '||'
 *
 * We also include ' ' for the omitted-combinator descendant case between
 * complex selector units.
 */
export type Combinator = ' ' | '>' | '+' | '~' | '||';

function tryParseCombinator(c: ComponentCursor): Combinator | null {
  return parseCombinator(c);
}

const parseCombinator: TryValueParser<Combinator> = (c) => {
  const start = c.pos();

  const sawWhitespace = c.match(TokenKind.Whitespace);
  const afterWhitespace = c.pos();

  const first = c.next();

  if (isDelimToken(first, '>')) {
    consumeComponentTrivia(c);
    return '>';
  }

  if (isDelimToken(first, '+')) {
    consumeComponentTrivia(c);
    return '+';
  }

  if (isDelimToken(first, '~')) {
    consumeComponentTrivia(c);
    return '~';
  }

  if (isDelimToken(first, '|')) {
    const second = c.next();

    if (isDelimToken(second, '|')) {
      consumeComponentTrivia(c);
      return '||';
    }
  }

  if (sawWhitespace) {
    c.restore(afterWhitespace);
    return ' ';
  }

  c.restore(start);
  return null;
};

/**
 * <wq-name> = <ns-prefix>? <ident-token>
 */
export type WqName = {
  type: 'wq-name';
  namespace: NsPrefix | null;
  name: string;
};

function tryParseWqName(c: ComponentCursor): WqName | null {
  return parseWqName(c);
}

// const parseWqName: TryValueParser<WqName> = map(
//   sequence(
//     opt(tryParseNsPrefix),
//     one(tryParseIdentToken),
//   ),
//   ([namespace, [name]]): WqName => ({
//     type: 'wq-name',
//     namespace: namespace[0] ?? null,
//     name: name.value,
//   }),
// );

const parseWqName: TryValueParser<WqName> = oneOf(
  map(
    sequence(
      one(tryParseNsPrefix),
      one(tryParseIdentToken),
    ),
    ([[namespace], [name]]): WqName => ({
      type: 'wq-name',
      namespace,
      name: name.value,
    }),
  ),

  map(
    one(tryParseIdentToken),
    ([name]): WqName => ({
      type: 'wq-name',
      namespace: null,
      name: name.value,
    }),
  ),
);

/**
 * <ns-prefix> = [ <ident-token> | '*' ]? '|'
 */
export type NsPrefix = {
  type: 'ns-prefix';
  prefix: string | null;
};

function tryParseNsPrefix(c: ComponentCursor): NsPrefix | null {
  return parseNsPrefix(c);
}

const parseNsPrefix: TryValueParser<NsPrefix> = map(
  sequence(
    opt(
      oneOf(
        map(one(tryParseIdentToken), ([ident]) => ident.value),
        tryParseDelim('*'),
      ),
    ),
    one(tryParseDelim('|')),
  ),
  ([prefix]): NsPrefix => ({
    type: 'ns-prefix',
    prefix: prefix[0] ?? null,
  }),
);

/**
 * <type-selector> = <wq-name> | <ns-prefix>? '*'
 */
export type TypeSelector = {
  type: 'type-selector';
  namespace: NsPrefix | null;
  name: string;
};

function tryParseTypeSelector(c: ComponentCursor): TypeSelector | null {
  return parseTypeSelector(c);
}

const parseTypeSelector: TryValueParser<TypeSelector> = oneOf(
  map(
    one(tryParseWqName),
    ([name]): TypeSelector => ({
      type: 'type-selector',
      namespace: name.namespace,
      name: name.name,
    }),
  ),

  map(
    sequence(
      opt(tryParseNsPrefix),
      one(tryParseDelim('*')),
    ),
    ([namespace]): TypeSelector => ({
      type: 'type-selector',
      namespace: namespace[0] ?? null,
      name: '*',
    }),
  ),
);

/**
 * <subclass-selector> =
 *   <id-selector> | <class-selector> |
 *   <attribute-selector> | <pseudo-class-selector>
 */
export type SubclassSelector =
  | IdSelector
  | ClassSelector
  | AttributeSelector
  | PseudoClassSelector;

function tryParseSubclassSelector(c: ComponentCursor): SubclassSelector | null {
  return parseSubclassSelector(c);
}

const parseSubclassSelector: TryValueParser<SubclassSelector> = oneOf(
  tryParseIdSelector,
  tryParseClassSelector,
  tryParseAttributeSelector,
  tryParsePseudoClassSelector,
);

/**
 * <id-selector> = <hash-token>
 *
 * Additional rule:
 *   The <hash-token>'s value must be an identifier.
 */
export type IdSelector = {
  type: 'id-selector';
  name: string;
};

function tryParseIdSelector(c: ComponentCursor): IdSelector | null {
  return parseIdSelector(c);
}

const parseIdSelector: TryValueParser<IdSelector> = map(
  one(tryParseIdHashToken),
  ([hash]): IdSelector => ({
    type: 'id-selector',
    name: hash.value,
  }),
);

/**
 * <class-selector> = '.' <ident-token>
 */
export type ClassSelector = {
  type: 'class-selector';
  name: string;
};

function tryParseClassSelector(c: ComponentCursor): ClassSelector | null {
  return parseClassSelector(c);
}

const parseClassSelector: TryValueParser<ClassSelector> = map(
  sequence(
    one(tryParseDelim('.')),
    one(tryParseIdentToken),
  ),
  ([, [ident]]): ClassSelector => ({
    type: 'class-selector',
    name: ident.value,
  }),
);

/**
 * <attribute-selector> =
 *   '[' <wq-name> ']' |
 *   '[' <wq-name> <attr-matcher> [ <string-token> | <ident-token> ] <attr-modifier>? ']'
 */
export type AttributeSelector = {
  type: 'attribute-selector';
  name: WqName;
  matcher: AttrMatcher | null;
  value: AttrValue | null;
  modifier: AttrModifier | null;
};

function tryParseAttributeSelector(c: ComponentCursor): AttributeSelector | null {
  return parseAttributeSelector(c);
}

const parseAttributeSelector: TryValueParser<AttributeSelector> = bracketed(
  oneOf(
    map(
      sequence(
        one(withComponentTrivia(tryParseWqName)),
        one(withComponentTrivia(tryParseAttrMatcher)),
        one(withComponentTrivia(tryParseAttrValue)),
        opt(withComponentTrivia(tryParseAttrModifier)),
      ),
      ([[name], [matcher], [value], modifier]): AttributeSelector => ({
        type: 'attribute-selector',
        name,
        matcher,
        value,
        modifier: modifier[0] ?? null,
      }),
    ),

    map(
      sequence(
        one(withComponentTrivia(tryParseWqName)),
      ),
      ([[name]]): AttributeSelector => ({
        type: 'attribute-selector',
        name,
        matcher: null,
        value: null,
        modifier: null,
      }),
    ),
  ),
);

/**
 * <attr-matcher> = [ '~' | '|' | '^' | '$' | '*' ]? '='
 */
export type AttrMatcher = '=' | '~=' | '|=' | '^=' | '$=' | '*=';

function tryParseAttrMatcher(c: ComponentCursor): AttrMatcher | null {
  return parseAttrMatcher(c);
}

const parseAttrMatcher: TryValueParser<AttrMatcher> = oneOf(
  tryParseDelim('='),

  map(
    sequence(
      one(oneOf(
        tryParseDelim('~'),
        tryParseDelim('|'),
        tryParseDelim('^'),
        tryParseDelim('$'),
        tryParseDelim('*'),
      )),
      one(tryParseDelim('=')),
    ),
    ([[prefix]]): AttrMatcher => `${prefix}=`,
  ),
);

/**
 * [ <string-token> | <ident-token> ]
 */
export type AttrValue =
  | { type: 'string'; value: string; }
  | { type: 'ident'; value: string; };

function tryParseAttrValue(c: ComponentCursor): AttrValue | null {
  return parseAttrValue(c);
}

const parseAttrValue: TryValueParser<AttrValue> = oneOf(
  map(
    one(tryParseStringToken),
    ([value]): AttrValue => ({
      type: 'string',
      value: value.value,
    }),
  ),

  map(
    one(tryParseIdentToken),
    ([value]): AttrValue => ({
      type: 'ident',
      value: value.value,
    }),
  ),
);

/**
 * <attr-modifier> = i | s
 */
export type AttrModifier = 'i' | 's';

function tryParseAttrModifier(c: ComponentCursor): AttrModifier | null {
  return parseAttrModifier(c);
}

const parseAttrModifier: TryValueParser<AttrModifier> = oneOf(
  tryParseIdent('i'),
  tryParseIdent('s'),
);

/**
 * <pseudo-class-selector> =
 *   : <ident-token> |
 *   : <function-token> <any-value> )
 */
export type PseudoClassSelector = {
  type: 'pseudo-class-selector';
  name: string;
  value: ComponentValue[] | null;
};

const parsePseudoClassSelector: TryValueParser<PseudoClassSelector> = oneOf(
  map(
    sequence(
      one(tryParseColon),
      one(tryParseNonLegacyIdentToken),
    ),
    ([, [ident]]): PseudoClassSelector => ({
      type: 'pseudo-class-selector',
      name: ident.value,
      value: null,
    }),
  ),

  map(
    sequence(
      one(tryParseColon),
      one(tryParseFunctionBlock),
    ),
    ([, [fn]]): PseudoClassSelector => ({
      type: 'pseudo-class-selector',
      name: fn.name,
      value: fn.value,
    }),
  ),
);

function tryParsePseudoClassSelector(c: ComponentCursor): PseudoClassSelector | null {
  return parsePseudoClassSelector(c);
}

/**
 * <pseudo-element-selector> =
 *   : <pseudo-class-selector> | <legacy-pseudo-element-selector>
 */
export type PseudoElementSelector = {
  type: 'pseudo-element-selector';
  name: string;
  value: ComponentValue[] | null;
  legacy: boolean;
};

function tryParsePseudoElementSelector(c: ComponentCursor): PseudoElementSelector | null {
  return parsePseudoElementSelector(c);
}

const parsePseudoElementSelector: TryValueParser<PseudoElementSelector> = oneOf(
  map(
    one(tryParseLegacyPseudoElementSelector),
    ([legacy]): PseudoElementSelector => ({
      type: 'pseudo-element-selector',
      name: legacy.name,
      value: null,
      legacy: true,
    }),
  ),

  map(
    sequence(
      one(tryParseColon),
      one(tryParseColon),
      one(oneOf(
        map(
          one(tryParseIdentToken),
          ([ident]) => ({
            name: ident.value,
            value: null,
          }),
        ),

        map(
          one(tryParseFunctionBlock),
          ([fn]) => ({
            name: fn.name,
            value: fn.value,
          }),
        ),
      )),
    ),
    ([, , [pseudo]]): PseudoElementSelector => ({
      type: 'pseudo-element-selector',
      name: pseudo.name,
      value: pseudo.value,
      legacy: false,
    }),
  ),
);

/**
 * <legacy-pseudo-element-selector> =
 *   : [before | after | first-line | first-letter]
 */

export type LegacyPseudoElementSelector = {
  type: 'legacy-pseudo-element-selector';
  name: 'before' | 'after' | 'first-line' | 'first-letter';
};

const parseLegacyPseudoElementSelector: TryValueParser<LegacyPseudoElementSelector> = map(
  sequence(
    one(tryParseColon),
    one(oneOf(
      tryParseIdent('before'),
      tryParseIdent('after'),
      tryParseIdent('first-line'),
      tryParseIdent('first-letter'),
    )),
  ),
  ([, [name]]): LegacyPseudoElementSelector => ({
    type: 'legacy-pseudo-element-selector',
    name,
  }),
);

function tryParseLegacyPseudoElementSelector(c: ComponentCursor): LegacyPseudoElementSelector | null {
  return parseLegacyPseudoElementSelector(c);
}


// Helpers and simple parsers

function bracketed<T>(parse: TryValueParser<T>): TryValueParser<T> {
  return (c) => {
    const start = c.pos();
    const block = tryParseBracketBlock(c);

    if (block === null) {
      return null;
    }

    const inner = new ComponentCursor(block.value);
    const value = parse(inner);

    if (value === null) {
      c.restore(start);
      return null;
    }

    consumeComponentTrivia(inner);

    if (inner.peek() !== null) {
      c.restore(start);
      return null;
    }

    return value;
  };
}

function tryParseNonLegacyIdentToken(c: ComponentCursor): IdentToken | null {
  const start = c.pos();
  const ident = tryParseIdentToken(c);

  if (ident === null || isLegacyPseudoElementName(ident.value)) {
    c.restore(start);
    return null;
  }

  return ident;
}

function tryParseColon(c: ComponentCursor): ':' | null {
  return c.match(TokenKind.Colon) ? ':' : null;
}

function tryParseDelim<T extends string>(expected: T): TryValueParser<T> {
  return (c) => {
    const start = c.pos();
    const comp = c.next();

    if (!isDelimToken(comp, expected)) {
      c.restore(start);
      return null;
    }

    return expected;
  };
}

function tryParseIdentToken(c: ComponentCursor): IdentToken | null {
  const start = c.pos();
  const comp = c.next();

  if (!isIdentToken(comp)) {
    c.restore(start);
    return null;
  }

  return comp;
}

function tryParseIdent<T extends string>(expected: T): TryValueParser<T> {
  return (c) => {
    const start = c.pos();
    const comp = c.next();

    if (!isIdentTokenWithValue(comp, expected, true)) {
      c.restore(start);
      return null;
    }

    return expected;
  };
}

function tryParseStringToken(c: ComponentCursor): StringToken | null {
  const start = c.pos();
  const comp = c.next();

  if (!isTokenKind(comp, TokenKind.String)) {
    c.restore(start);
    return null;
  }

  return comp;
}

function tryParseIdHashToken(c: ComponentCursor): HashToken | null {
  const start = c.pos();
  const comp = c.next();

  if (
    !isTokenKind(comp, TokenKind.Hash) ||
    comp.flag !== HashTokenFlag.Id
  ) {
    c.restore(start);
    return null;
  }

  return comp;
}

function tryParseFunctionBlock(c: ComponentCursor): FunctionBlock | null {
  const start = c.pos();
  const comp = c.next();

  if (!isFunctionBlock(comp)) {
    c.restore(start);
    return null;
  }

  return comp;
}

function tryParseBracketBlock(c: ComponentCursor): BracketBlock | null {
  const start = c.pos();
  const comp = c.next();

  if (!isBlockKind(comp, BlockKind.Bracket)) {
    c.restore(start);
    return null;
  }

  return comp;
}

function isLegacyPseudoElementName(name: string): boolean {
  switch (asciiLower(name)) {
    case 'before':
    case 'after':
    case 'first-line':
    case 'first-letter':
      return true;

    default:
      return false;
  }
}
