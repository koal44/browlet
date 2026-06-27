import { asciiLower } from '../../utils/css';
import {
  any, commaRepeat, one, oneOf, opt, sequenceOf, withComponentTrivia, requiredSequenceOf,
  type TryValueParser,
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
  commaRepeat(tryParseComplexSelector);

/**
 * <complex-real-selector-list> = <complex-real-selector>#
 */
export type ComplexRealSelectorList = ComplexRealSelector[];

export function tryParseComplexRealSelectorList(c: ComponentCursor): ComplexRealSelectorList | null {
  return parseComplexRealSelectorList(c);
}

const parseComplexRealSelectorList: TryValueParser<ComplexRealSelectorList> =
  commaRepeat(tryParseComplexRealSelector);

/**
 * <compound-selector-list> = <compound-selector>#
 */
export type CompoundSelectorList = CompoundSelector[];

export function tryParseCompoundSelectorList(c: ComponentCursor): CompoundSelectorList | null {
  return parseCompoundSelectorList(c);
}

const parseCompoundSelectorList: TryValueParser<CompoundSelectorList> =
  commaRepeat(tryParseCompoundSelector);

/**
 * <simple-selector-list> = <simple-selector>#
 */
export type SimpleSelectorList = SimpleSelector[];

export function tryParseSimpleSelectorList(c: ComponentCursor): SimpleSelectorList | null {
  return parseSimpleSelectorList(c);
}

const parseSimpleSelectorList: TryValueParser<SimpleSelectorList> =
  commaRepeat(tryParseSimpleSelector);

/**
 * <relative-selector-list> = <relative-selector>#
 */
export type RelativeSelectorList = RelativeSelector[];

export function tryParseRelativeSelectorList(c: ComponentCursor): RelativeSelectorList | null {
  return parseRelativeSelectorList(c);
}

const parseRelativeSelectorList: TryValueParser<RelativeSelectorList> =
  commaRepeat(tryParseRelativeSelector);

/**
 * <relative-real-selector-list> = <relative-real-selector>#
 */
export type RelativeRealSelectorList = RelativeRealSelector[];

export function tryParseRelativeRealSelectorList(c: ComponentCursor): RelativeRealSelectorList | null {
  return parseRelativeRealSelectorList(c);
}

const parseRelativeRealSelectorList: TryValueParser<RelativeRealSelectorList> =
  commaRepeat(tryParseRelativeRealSelector);

/**
 * <complex-selector> =
 *   <complex-selector-unit> [ <combinator>? <complex-selector-unit> ]*
 */
export type ComplexSelector = {
  type: 'complex-selector';
  parts: {
    combinator: Combinator | null;
    unit: ComplexSelectorUnit;
  }[];
};

function tryParseComplexSelector(c: ComponentCursor): ComplexSelector | null {
  return parseComplexSelector(c);
}

const parseComplexSelector: TryValueParser<ComplexSelector> = sequenceOf(
  one(tryParseComplexSelectorUnit),

  any(
    sequenceOf(
      one(tryParseCombinator),
      one(tryParseComplexSelectorUnit),
      ([[combinator], [unit]]) => ({
        combinator,
        unit,
      }),
    ),
  ),

  ([[head], tail]): ComplexSelector => ({
    type: 'complex-selector',
    parts: [{ combinator: null, unit: head }, ...tail],
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

const parseComplexSelectorUnit: TryValueParser<ComplexSelectorUnit> = requiredSequenceOf(
  opt(tryParseCompoundSelector),
  any(tryParsePseudoCompoundSelector),

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
  parts: {
    combinator: Combinator | null;
    compound: CompoundSelector;
  }[];
};

function tryParseComplexRealSelector(c: ComponentCursor): ComplexRealSelector | null {
  return parseComplexRealSelector(c);
}

const parseComplexRealSelector: TryValueParser<ComplexRealSelector> = sequenceOf(
  one(tryParseCompoundSelector),

  any(
    sequenceOf(
      one(tryParseCombinator),
      one(tryParseCompoundSelector),
      ([[combinator], [compound]]) => ({
        combinator,
        compound,
      }),
    ),
  ),

  ([[head], tail]): ComplexRealSelector => ({
    type: 'complex-real-selector',
    parts: [{ combinator: null, compound: head }, ...tail],
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

const parseRelativeSelector: TryValueParser<RelativeSelector> = sequenceOf(
  opt(tryParseCombinator),
  one(tryParseComplexSelector),

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

const parseRelativeRealSelector: TryValueParser<RelativeRealSelector> = sequenceOf(
  opt(tryParseCombinator),
  one(tryParseComplexRealSelector),

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

const parseCompoundSelector: TryValueParser<CompoundSelector> = requiredSequenceOf(
  opt(tryParseTypeSelector),
  any(tryParseSubclassSelector),

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

const parsePseudoCompoundSelector: TryValueParser<PseudoCompoundSelector> = sequenceOf(
  one(tryParsePseudoElementSelector),
  any(tryParsePseudoClassSelector),

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
  one(tryParseTypeSelector),
  one(tryParseSubclassSelector),

  ([selector]): SimpleSelector => selector,
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

const parseWqName: TryValueParser<WqName> = sequenceOf(
  opt(tryParseNsPrefix),
  one(tryParseIdentToken),

  ([namespace, [name]]): WqName => ({
    type: 'wq-name',
    namespace: namespace[0] ?? null,
    name: name.value,
  }),
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

const parseNsPrefix: TryValueParser<NsPrefix> = sequenceOf(
  opt(
    oneOf(
      one(tryParseIdentToken),
      one(tryParseDelim('*')),

      ([prefix]) => (
        typeof prefix === 'string'
          ? prefix
          : prefix.value
      ),
    ),
  ),
  one(tryParseDelim('|')),

  ([prefix]): NsPrefix => ({
    type: 'ns-prefix',
    prefix: prefix[0] ?? null,
  }),
);

/**
 * <type-selector> = <wq-name> | <ns-prefix>? '*'
 *
 * Since:
 *
 *   <wq-name> = <ns-prefix>? <ident-token>
 *
 * We parse the equivalent factored form:
 *
 *   <type-selector> = <ns-prefix>? [ <ident-token> | '*' ]
 *
 * This avoids the committed-alternative ambiguity where `svg|*` can be
 * partially accepted as a bare `<wq-name>` `svg`, leaving `|*` behind.
 */
export type TypeSelector = {
  type: 'type-selector';
  namespace: NsPrefix | null;
  name: string;
};

function tryParseTypeSelector(c: ComponentCursor): TypeSelector | null {
  return parseTypeSelector(c);
}

const parseTypeSelector: TryValueParser<TypeSelector> = sequenceOf(
  opt(tryParseNsPrefix),

  one(
    oneOf(
      one(tryParseIdentToken),
      one(tryParseDelim('*')),

      ([name]): string => (
        typeof name === 'string'
          ? name
          : name.value
      ),
    ),
  ),

  ([namespace, [name]]): TypeSelector => ({
    type: 'type-selector',
    namespace: namespace[0] ?? null,
    name,
  }),
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
  one(tryParseIdSelector),
  one(tryParseClassSelector),
  one(tryParseAttributeSelector),
  one(tryParsePseudoClassSelector),

  ([selector]): SubclassSelector => selector,
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

const parseIdSelector: TryValueParser<IdSelector> = sequenceOf(
  one(tryParseIdHashToken),

  ([[hash]]): IdSelector => ({
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

const parseClassSelector: TryValueParser<ClassSelector> = sequenceOf(
  one(tryParseDelim('.')),
  one(tryParseIdentToken),

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
    one(
      sequenceOf(
        one(withComponentTrivia(tryParseWqName)),
        one(withComponentTrivia(tryParseAttrMatcher)),
        one(withComponentTrivia(tryParseAttrValue)),
        opt(withComponentTrivia(tryParseAttrModifier)),

        ([[name], [matcher], [value], modifier]): AttributeSelector => ({
          type: 'attribute-selector',
          name,
          matcher,
          value,
          modifier: modifier[0] ?? null,
        }),
      ),
    ),

    one(
      sequenceOf(
        one(withComponentTrivia(tryParseWqName)),

        ([[name]]): AttributeSelector => ({
          type: 'attribute-selector',
          name,
          matcher: null,
          value: null,
          modifier: null,
        }),
      ),
    ),

    ([selector]): AttributeSelector => selector,
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
  one(tryParseDelim('=')),

  one(
    sequenceOf(
      one(
        oneOf(
          one(tryParseDelim('~')),
          one(tryParseDelim('|')),
          one(tryParseDelim('^')),
          one(tryParseDelim('$')),
          one(tryParseDelim('*')),

          ([prefix]) => prefix,
        )
      ),
      one(tryParseDelim('=')),

      ([[prefix]]): AttrMatcher => `${prefix}=`,
    ),
  ),

  ([matcher]): AttrMatcher => matcher,
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
  one(
    sequenceOf(
      one(tryParseStringToken),

      ([[value]]): AttrValue => ({
        type: 'string',
        value: value.value,
      }),
    ),
  ),

  one(
    sequenceOf(
      one(tryParseIdentToken),

      ([[value]]): AttrValue => ({
        type: 'ident',
        value: value.value,
      }),
    ),
  ),

  ([value]): AttrValue => value,
);

/**
 * <attr-modifier> = i | s
 */
export type AttrModifier = 'i' | 's';

function tryParseAttrModifier(c: ComponentCursor): AttrModifier | null {
  return parseAttrModifier(c);
}

const parseAttrModifier: TryValueParser<AttrModifier> = oneOf(
  one(tryParseIdent('i')),
  one(tryParseIdent('s')),

  ([modifier]): AttrModifier => modifier,
);

/**
 * <pseudo-class-selector> =
 *   : <ident-token> |
 *   : <function-token> <any-value> )
 */
export type PseudoClassSelector = {
  type: 'pseudo-class-selector';
  name: string;
  argument: PseudoClassArgument | null;
};

function tryParsePseudoClassSelector(c: ComponentCursor): PseudoClassSelector | null {
  return parsePseudoClassSelector(c);
}

const parsePseudoClassSelector: TryValueParser<PseudoClassSelector> = oneOf(
  one(
    sequenceOf(
      one(tryParseColon),
      one(tryParseNonLegacyIdentToken),

      ([, [ident]]) => createPseudoClassSelector(ident.value, null),
    ),
  ),

  one(
    sequenceOf(
      one(tryParseColon),
      one(tryParseFunctionBlock),

      ([, [fn]]) => createPseudoClassSelector(fn.name, fn.value),
    ),
  ),

  ([selector]): PseudoClassSelector | null => selector,
);

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
  one(
    sequenceOf(
      one(tryParseLegacyPseudoElementSelector),

      ([[legacy]]): PseudoElementSelector => ({
        type: 'pseudo-element-selector',
        name: legacy.name,
        value: null,
        legacy: true,
      }),
    ),
  ),

  one(
    sequenceOf(
      one(tryParseColon),
      one(tryParseColon),
      one(
        oneOf(
          one(
            sequenceOf(
              one(tryParseIdentToken),

              ([[ident]]) => ({
                name: ident.value,
                value: null,
              }),
            ),
          ),

          one(
            sequenceOf(
              one(tryParseFunctionBlock),

              ([[fn]]) => ({
                name: fn.name,
                value: fn.value,
              }),
            ),
          ),

          ([pseudo]) => pseudo,
        ),
      ),

      ([, , [pseudo]]): PseudoElementSelector => ({
        type: 'pseudo-element-selector',
        name: pseudo.name,
        value: pseudo.value,
        legacy: false,
      }),
    ),
  ),

  ([selector]): PseudoElementSelector => selector,
);

/**
 * <legacy-pseudo-element-selector> =
 *   : [before | after | first-line | first-letter]
 */

export type LegacyPseudoElementSelector = {
  type: 'legacy-pseudo-element-selector';
  name: 'before' | 'after' | 'first-line' | 'first-letter';
};

function tryParseLegacyPseudoElementSelector(c: ComponentCursor): LegacyPseudoElementSelector | null {
  return parseLegacyPseudoElementSelector(c);
}

const parseLegacyPseudoElementSelector: TryValueParser<LegacyPseudoElementSelector> = sequenceOf(
  one(tryParseColon),
  one(
    oneOf(
      one(tryParseIdent('before')),
      one(tryParseIdent('after')),
      one(tryParseIdent('first-line')),
      one(tryParseIdent('first-letter')),

      ([name]) => name,
    ),
  ),

  ([, [name]]): LegacyPseudoElementSelector => ({
    type: 'legacy-pseudo-element-selector',
    name,
  }),
);


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

export type PseudoClassArgument =
  | SelectorListPseudoClassArgument
  | RelativeSelectorListPseudoClassArgument
  | AnPlusBPseudoClassArgument;

export type SelectorListPseudoClassArgument = {
  type: 'selector-list';
  selectors: SelectorList;
};

export type RelativeSelectorListPseudoClassArgument = {
  type: 'relative-selector-list';
  selectors: RelativeSelectorList;
};

export type AnPlusBPseudoClassArgument = {
  type: 'an-plus-b';
  a: number;
  b: number;
};

function createPseudoClassSelector(name: string, value: ComponentValue[] | null): PseudoClassSelector | null {
  const argument = parsePseudoClassArgument(name, value);

  if (argument === null) {
    return null;
  }

  return {
    type: 'pseudo-class-selector',
    name,
    argument,
  };
}

function parsePseudoClassArgument(_name: string, _value: ComponentValue[] | null): PseudoClassArgument | null {
  throw new Error('Function not implemented.');
}

// function parsePseudoClassArgument(
//   name: string,
//   value: ComponentValue[],
// ): PseudoClassArgument | null {
//   switch (asciiLower(name)) {
//     case 'is':
//     case 'where':
//     case 'not':
//       return parseSelectorListArgument(value);

//     case 'has':
//       return parseRelativeSelectorListArgument(value);

//     case 'nth-child':
//     case 'nth-last-child':
//     case 'nth-of-type':
//     case 'nth-last-of-type':
//       return parseAnPlusBArgument(value);

//     default:
//       return {
//         type: 'raw',
//         value,
//       };
//   }
// }

