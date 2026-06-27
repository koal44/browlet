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
import type {
  AnPlusBPseudoClassArgument, ComplexRealSelectorListPseudoClassArgument, CompoundSelectorPseudoClassArgument, ForgivingSelectorListPseudoClassArgument,
  IdentPseudoElementArgument, PseudoClassArgument, PseudoElementArgument, RelativeSelectorListPseudoClassArgument,
  SelectorListPseudoElementArgument,
} from './selector-pseudo';
import { PSEUDO_CLASSES, PSEUDO_ELEMENTS, PseudoClassArgumentKind, PseudoElementArgumentKind } from './selector-pseudo';
import {
  listSpecificity, SpecificityB, SpecificityA, SpecificityC, Specificity0, sumSpecificity, type Specificity,
} from './specificity';

export enum SelectorType {
  ComplexSelectorList = 'complex-selector-list',
  ComplexRealSelectorList = 'complex-real-selector-list',
  CompoundSelectorList = 'compound-selector-list',
  SimpleSelectorList = 'simple-selector-list',
  RelativeSelectorList = 'relative-selector-list',
  RelativeRealSelectorList = 'relative-real-selector-list',
  ComplexSelector = 'complex-selector',
  ComplexSelectorUnit = 'complex-selector-unit',
  ComplexRealSelector = 'complex-real-selector',
  RelativeSelector = 'relative-selector',
  RelativeRealSelector = 'relative-real-selector',
  CompoundSelector = 'compound-selector',
  PseudoCompoundSelector = 'pseudo-compound-selector',
  TypeSelector = 'type-selector',
  IdSelector = 'id-selector',
  ClassSelector = 'class-selector',
  AttributeSelector = 'attribute-selector',
  PseudoClassSelector = 'pseudo-class-selector',
  PseudoElementSelector = 'pseudo-element-selector',
  LegacyPseudoElementSelector = 'legacy-pseudo-element-selector',
}

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
export type ComplexSelectorList = {
  type: SelectorType.ComplexSelectorList;
  arms: ComplexSelector[];
  specificity: Specificity;
}

function tryParseComplexSelectorList(c: ComponentCursor): ComplexSelectorList | null {
  const arms = parseComplexSelectorListArms(c);
  if (arms === null) return null;

  return {
    type: SelectorType.ComplexSelectorList,
    arms,
    specificity: listSpecificity(arms),
  };
}

const parseComplexSelectorListArms: TryValueParser<ComplexSelector[]> =
  commaRepeat(tryParseComplexSelector);

/**
 * <complex-real-selector-list> = <complex-real-selector>#
 */
export type ComplexRealSelectorList = {
  type: SelectorType.ComplexRealSelectorList;
  arms: ComplexRealSelector[];
  specificity: Specificity;
}

export function tryParseComplexRealSelectorList(c: ComponentCursor): ComplexRealSelectorList | null {
  const arms = parseComplexRealSelectorListArms(c);
  if (arms === null) return null;

  return {
    type: SelectorType.ComplexRealSelectorList,
    arms,
    specificity: listSpecificity(arms),
  };
}

const parseComplexRealSelectorListArms: TryValueParser<ComplexRealSelector[]> =
  commaRepeat(tryParseComplexRealSelector);

/**
 * <compound-selector-list> = <compound-selector>#
 */
export type CompoundSelectorList = {
  type: SelectorType.CompoundSelectorList;
  arms: CompoundSelector[];
  specificity: Specificity;
}

export function tryParseCompoundSelectorList(c: ComponentCursor): CompoundSelectorList | null {
  const arms = parseCompoundSelectorListArms(c);
  if (arms === null) return null;

  return {
    type: SelectorType.CompoundSelectorList,
    arms,
    specificity: listSpecificity(arms),
  };
}

const parseCompoundSelectorListArms: TryValueParser<CompoundSelector[]> =
  commaRepeat(tryParseCompoundSelector);

/**
 * <simple-selector-list> = <simple-selector>#
 */
export type SimpleSelectorList = {
  type: SelectorType.SimpleSelectorList;
  arms: SimpleSelector[];
  specificity: Specificity;
}

export function tryParseSimpleSelectorList(c: ComponentCursor): SimpleSelectorList | null {
  const arms = parseSimpleSelectorListArms(c);
  if (arms === null) return null;

  return {
    type: SelectorType.SimpleSelectorList,
    arms,
    specificity: listSpecificity(arms),
  };
}

const parseSimpleSelectorListArms: TryValueParser<SimpleSelector[]> =
  commaRepeat(tryParseSimpleSelector);

/**
 * <relative-selector-list> = <relative-selector>#
 */
export type RelativeSelectorList = {
  type: SelectorType.RelativeSelectorList;
  arms: RelativeSelector[];
  specificity: Specificity;
}

export function tryParseRelativeSelectorList(c: ComponentCursor): RelativeSelectorList | null {
  const arms = parseRelativeSelectorListArms(c);
  if (arms === null) return null;

  return {
    type: SelectorType.RelativeSelectorList,
    arms,
    specificity: listSpecificity(arms),
  };
}

const parseRelativeSelectorListArms: TryValueParser<RelativeSelector[]> =
  commaRepeat(tryParseRelativeSelector);

/**
 * <relative-real-selector-list> = <relative-real-selector>#
 */
export type RelativeRealSelectorList = {
  type: SelectorType.RelativeRealSelectorList;
  arms: RelativeRealSelector[];
  specificity: Specificity;
}

export function tryParseRelativeRealSelectorList(c: ComponentCursor): RelativeRealSelectorList | null {
  const arms = parseRelativeRealSelectorListArms(c);
  if (arms === null) return null;

  return {
    type: SelectorType.RelativeRealSelectorList,
    arms,
    specificity: listSpecificity(arms),
  };
}

const parseRelativeRealSelectorListArms: TryValueParser<RelativeRealSelector[]> =
  commaRepeat(tryParseRelativeRealSelector);

/**
 * <complex-selector> =
 *   <complex-selector-unit> [ <combinator>? <complex-selector-unit> ]*
 */
export type ComplexSelector = {
  type: SelectorType.ComplexSelector;
  parts: {
    combinator: Combinator | null;
    unit: ComplexSelectorUnit;
  }[];
  specificity: Specificity;
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
        combinator: combinator,
        unit: unit,
      }),
    ),
  ),

  ([[head], tail]): ComplexSelector => ({
    type: SelectorType.ComplexSelector,
    parts: [{ combinator: null, unit: head }, ...tail],
    specificity: sumSpecificity([
      head.specificity,
      ...tail.map((part) => part.unit.specificity),
    ]),
  }),
);

/**
 * <complex-selector-unit> =
 *   [ <compound-selector>? <pseudo-compound-selector>* ]!
 */
export type ComplexSelectorUnit = {
  type: SelectorType.ComplexSelectorUnit;
  compound: CompoundSelector | null;
  pseudoCompounds: PseudoCompoundSelector[];
  specificity: Specificity;
};

function tryParseComplexSelectorUnit(c: ComponentCursor): ComplexSelectorUnit | null {
  return parseComplexSelectorUnit(c);
}

const parseComplexSelectorUnit: TryValueParser<ComplexSelectorUnit> = requiredSequenceOf(
  opt(tryParseCompoundSelector),
  any(tryParsePseudoCompoundSelector),

  ([[compound], pseudoCompounds]): ComplexSelectorUnit => ({
    type: SelectorType.ComplexSelectorUnit,
    compound: compound ?? null,
    pseudoCompounds,
    specificity: sumSpecificity([
      compound?.specificity,
      ...pseudoCompounds.map((pseudo) => pseudo.specificity),
    ]),
  }),
);

/**
 * <complex-real-selector> =
 *   <compound-selector> [ <combinator>? <compound-selector> ]*
 */
export type ComplexRealSelector = {
  type: SelectorType.ComplexRealSelector;
  parts: {
    combinator: Combinator | null;
    compound: CompoundSelector;
  }[];
  specificity: Specificity;
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
    type: SelectorType.ComplexRealSelector,
    parts: [{ combinator: null, compound: head }, ...tail],
    specificity: sumSpecificity([
      head.specificity,
      ...tail.map((part) => part.compound.specificity),
    ]),
  }),
);

/**
 * <relative-selector> = <combinator>? <complex-selector>
 */
export type RelativeSelector = {
  type: SelectorType.RelativeSelector;
  combinator: Combinator | null;
  selector: ComplexSelector;
  specificity: Specificity;
};

export function tryParseRelativeSelector(c: ComponentCursor): RelativeSelector | null {
  return parseRelativeSelector(c);
}

const parseRelativeSelector: TryValueParser<RelativeSelector> = sequenceOf(
  opt(tryParseCombinator),
  one(tryParseComplexSelector),

  ([combinator, [selector]]): RelativeSelector => ({
    type: SelectorType.RelativeSelector,
    combinator: combinator[0] ?? null,
    selector,
    specificity: selector.specificity,
  }),
);

/**
 * <relative-real-selector> = <combinator>? <complex-real-selector>
 */
export type RelativeRealSelector = {
  type: SelectorType.RelativeRealSelector;
  combinator: Combinator | null;
  selector: ComplexRealSelector;
  specificity: Specificity;
};

export function tryParseRelativeRealSelector(c: ComponentCursor): RelativeRealSelector | null {
  return parseRelativeRealSelector(c);
}

const parseRelativeRealSelector: TryValueParser<RelativeRealSelector> = sequenceOf(
  opt(tryParseCombinator),
  one(tryParseComplexRealSelector),

  ([combinator, [selector]]): RelativeRealSelector => ({
    type: SelectorType.RelativeRealSelector,
    combinator: combinator[0] ?? null,
    selector,
    specificity: selector.specificity,
  }),
);

/**
 * <compound-selector> = [ <type-selector>? <subclass-selector>* ]!
 */
export type CompoundSelector = {
  type: SelectorType.CompoundSelector;
  typeSelector: TypeSelector | null;
  subclasses: SubclassSelector[];
  specificity: Specificity;
};

function tryParseCompoundSelector(c: ComponentCursor): CompoundSelector | null {
  return parseCompoundSelector(c);
}

const parseCompoundSelector: TryValueParser<CompoundSelector> = requiredSequenceOf(
  opt(tryParseTypeSelector),
  any(tryParseSubclassSelector),

  ([[typeSelector], subclasses]): CompoundSelector => ({
    type: SelectorType.CompoundSelector,
    typeSelector: typeSelector ?? null,
    subclasses,
    specificity: sumSpecificity([
      typeSelector?.specificity,
      ...subclasses.map((subclass) => subclass.specificity),
    ]),
  }),
);

/**
 * <pseudo-compound-selector> =
 *   <pseudo-element-selector> <pseudo-class-selector>*
 */
export type PseudoCompoundSelector = {
  type: SelectorType.PseudoCompoundSelector;
  pseudoElement: PseudoElementSelector;
  pseudoClasses: PseudoClassSelector[];
  specificity: Specificity;
};

function tryParsePseudoCompoundSelector(c: ComponentCursor): PseudoCompoundSelector | null {
  return parsePseudoCompoundSelector(c);
}

const parsePseudoCompoundSelector: TryValueParser<PseudoCompoundSelector> = sequenceOf(
  one(tryParsePseudoElementSelector),
  any(tryParsePseudoClassSelector),

  ([[pseudoElement], pseudoClasses]): PseudoCompoundSelector => ({
    type: SelectorType.PseudoCompoundSelector,
    pseudoElement,
    pseudoClasses,
    specificity: sumSpecificity([
      pseudoElement.specificity,
      ...pseudoClasses.map((pseudo) => pseudo.specificity),
    ]),
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
  type: SelectorType.TypeSelector;
  namespace: NsPrefix | null;
  name: string;
  specificity: Specificity;
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
    type: SelectorType.TypeSelector,
    namespace: namespace[0] ?? null,
    name,
    specificity: name === '*' ? Specificity0 : SpecificityC,
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
  type: SelectorType.IdSelector;
  name: string;
  specificity: Specificity;
};

function tryParseIdSelector(c: ComponentCursor): IdSelector | null {
  return parseIdSelector(c);
}

const parseIdSelector: TryValueParser<IdSelector> = sequenceOf(
  one(tryParseIdHashToken),

  ([[hash]]): IdSelector => ({
    type: SelectorType.IdSelector,
    name: hash.value,
    specificity: SpecificityA,
  }),
);

/**
 * <class-selector> = '.' <ident-token>
 */
export type ClassSelector = {
  type: SelectorType.ClassSelector;
  name: string;
  specificity: Specificity;
};

function tryParseClassSelector(c: ComponentCursor): ClassSelector | null {
  return parseClassSelector(c);
}

const parseClassSelector: TryValueParser<ClassSelector> = sequenceOf(
  one(tryParseDelim('.')),
  one(tryParseIdentToken),

  ([, [ident]]): ClassSelector => ({
    type: SelectorType.ClassSelector,
    name: ident.value,
    specificity: SpecificityB,
  }),
);

/**
 * <attribute-selector> =
 *   '[' <wq-name> ']' |
 *   '[' <wq-name> <attr-matcher> [ <string-token> | <ident-token> ] <attr-modifier>? ']'
 */
export type AttributeSelector = {
  type: SelectorType.AttributeSelector;
  name: WqName;
  matcher: AttrMatcher | null;
  value: AttrValue | null;
  modifier: AttrModifier | null;
  specificity: Specificity;
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
          type: SelectorType.AttributeSelector,
          name,
          matcher,
          value,
          modifier: modifier[0] ?? null,
          specificity: SpecificityB,
        }),
      ),
    ),

    one(
      sequenceOf(
        one(withComponentTrivia(tryParseWqName)),

        ([[name]]): AttributeSelector => ({
          type: SelectorType.AttributeSelector,
          name,
          matcher: null,
          value: null,
          modifier: null,
          specificity: SpecificityB,
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
        ),
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
  type: SelectorType.PseudoClassSelector;
  name: string;
  argument: PseudoClassArgument | null;
  specificity: Specificity;
};

function tryParsePseudoClassSelector(c: ComponentCursor): PseudoClassSelector | null {
  return parsePseudoClassSelector(c);
}

type PseudoSelectorHead = {
  name: string;
  value: ComponentValue[] | null;
};

const parsePseudoSelectorHead: TryValueParser<PseudoSelectorHead> = oneOf(
  one(
    sequenceOf(
      one(tryParseColon),
      one(tryParseIdentToken),

      ([, [ident]]): PseudoSelectorHead => ({
        name: ident.value,
        value: null,
      }),
    ),
  ),

  one(
    sequenceOf(
      one(tryParseColon),
      one(tryParseFunctionBlock),

      ([, [fn]]): PseudoSelectorHead => ({
        name: fn.name,
        value: fn.value,
      }),
    ),
  ),

  ([head]): PseudoSelectorHead => head,
);

const parsePseudoClassSelector: TryValueParser<PseudoClassSelector> = sequenceOf(
  one(parsePseudoSelectorHead),

  ([[head]]): PseudoClassSelector | null =>
    createPseudoClassSelector(head.name, head.value),
);

/**
 * <pseudo-element-selector> =
 *   : <pseudo-class-selector> | <legacy-pseudo-element-selector>
 */
export type PseudoElementSelector = {
  type: SelectorType.PseudoElementSelector;
  name: string;
  argument: PseudoElementArgument | null;
  legacy: boolean;
  specificity: Specificity;
};

function tryParsePseudoElementSelector(c: ComponentCursor): PseudoElementSelector | null {
  return parsePseudoElementSelector(c);
}

const parsePseudoElementSelector: TryValueParser<PseudoElementSelector> = oneOf(
  one(
    sequenceOf(
      one(tryParseLegacyPseudoElementSelector),

      ([[legacy]]): PseudoElementSelector | null =>
        createPseudoElementSelector(legacy.name, null, true),
    ),
  ),

  one(
    sequenceOf(
      one(tryParseColon),
      one(parsePseudoSelectorHead),

      ([, [head]]): PseudoElementSelector | null =>
        createPseudoElementSelector(head.name, head.value, false),
    ),
  ),

  ([selector]): PseudoElementSelector | null => selector,
);

/**
 * <legacy-pseudo-element-selector> =
 *   : [before | after | first-line | first-letter]
 */
export type LegacyPseudoElementSelector = {
  type: SelectorType.LegacyPseudoElementSelector;
  name: 'before' | 'after' | 'first-line' | 'first-letter';
  specificity: Specificity;
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
    type: SelectorType.LegacyPseudoElementSelector,
    name,
    specificity: SpecificityC,
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

function createPseudoClassSelector(
  rawName: string,
  value: ComponentValue[] | null,
): PseudoClassSelector | null {
  const name = asciiLower(rawName);
  const def = PSEUDO_CLASSES[name];

  if (def === undefined) {
    return null;
  }

  if (value === null) {
    if (def.bare === undefined) {
      return null;
    }

    return {
      type: SelectorType.PseudoClassSelector,
      name,
      argument: null,
      specificity: def.bare.specificity,
    };
  }

  if (def.functional === undefined) {
    return null;
  }

  const argument = parsePseudoClassArgument(def.functional.argument, value);

  if (argument === null) {
    return null;
  }

  return {
    type: SelectorType.PseudoClassSelector,
    name,
    argument,
    specificity: def.functional.specificity(argument as never),
  };
}

export function parsePseudoClassArgument(
  kind: PseudoClassArgumentKind,
  value: ComponentValue[],
): PseudoClassArgument | null {
  switch (kind) {
    case PseudoClassArgumentKind.ForgivingSelectorList:
      return parseWholePseudoClassArgument(
        value,
        tryParseSelectorList,
        (selectors): ForgivingSelectorListPseudoClassArgument => ({
          type: PseudoClassArgumentKind.ForgivingSelectorList,
          selectors,
        }),
      );

    case PseudoClassArgumentKind.RelativeSelectorList:
      return parseWholePseudoClassArgument(
        value,
        tryParseRelativeSelectorList,
        (selectors): RelativeSelectorListPseudoClassArgument => ({
          type: PseudoClassArgumentKind.RelativeSelectorList,
          selectors,
        }),
      );

    case PseudoClassArgumentKind.ComplexRealSelectorList:
      return parseWholePseudoClassArgument(
        value,
        tryParseComplexRealSelectorList,
        (selectors): ComplexRealSelectorListPseudoClassArgument => ({
          type: PseudoClassArgumentKind.ComplexRealSelectorList,
          selectors,
        }),
      );

    case PseudoClassArgumentKind.CompoundSelector:
      return parseWholePseudoClassArgument(
        value,
        tryParseCompoundSelector,
        (selector): CompoundSelectorPseudoClassArgument => ({
          type: PseudoClassArgumentKind.CompoundSelector,
          selector,
        }),
      );

    case PseudoClassArgumentKind.AnPlusB:
      return parseWholePseudoClassArgument(
        value,
        tryParseAnPlusB,
        (anb): AnPlusBPseudoClassArgument => ({
          type: PseudoClassArgumentKind.AnPlusB,
          ...anb,
        }),
      );

    case PseudoClassArgumentKind.Direction:
    case PseudoClassArgumentKind.LanguageRangeList:
    case PseudoClassArgumentKind.NthChild:
      return null;
  }
}

function parseWholePseudoClassArgument<T, R extends PseudoClassArgument>(
  value: ComponentValue[],
  parse: TryValueParser<T>,
  create: (value: T) => R,
): R | null {
  const parsed = parseWholeComponentValueList(value, parse);

  if (parsed === null) {
    return null;
  }

  return create(parsed);
}

function parseWholePseudoElementArgument<T, R extends PseudoElementArgument>(
  value: ComponentValue[],
  parse: TryValueParser<T>,
  create: (value: T) => R,
): R | null {
  const parsed = parseWholeComponentValueList(value, parse);

  if (parsed === null) {
    return null;
  }

  return create(parsed);
}

function parseWholeComponentValueList<T>(
  value: ComponentValue[],
  parse: TryValueParser<T>,
): T | null {
  const c = new ComponentCursor(value);
  const result = parse(c);

  if (result === null) {
    return null;
  }

  consumeComponentTrivia(c);

  if (c.peek() !== null) {
    return null;
  }

  return result;
}

function tryParseAnPlusB(_c: ComponentCursor): { a: number; b: number; } | null {
  return null; // TODO: Implement An+B parser
}

function createPseudoElementSelector(
  rawName: string,
  value: ComponentValue[] | null,
  legacy: boolean,
): PseudoElementSelector | null {
  const name = asciiLower(rawName);
  const def = PSEUDO_ELEMENTS[name];

  if (def === undefined) {
    return null;
  }

  if (legacy && def.legacy !== true) {
    return null;
  }

  if (value === null) {
    if (def.bare === undefined) {
      return null;
    }

    return {
      type: SelectorType.PseudoElementSelector,
      name,
      argument: null,
      legacy,
      specificity: def.bare.specificity,
    };
  }

  if (def.functional === undefined) {
    return null;
  }

  if (legacy) {
    return null;
  }

  const argument = parsePseudoElementArgument(def.functional.argument, value);

  if (argument === null) {
    return null;
  }

  return {
    type: SelectorType.PseudoElementSelector,
    name,
    argument,
    legacy: false,
    specificity: def.functional.specificity(argument),
  };
}

function parsePseudoElementArgument(
  kind: PseudoElementArgumentKind,
  value: ComponentValue[],
): PseudoElementArgument | null {
  switch (kind) {
    case PseudoElementArgumentKind.Ident:
      return parseWholePseudoElementArgument(
        value,
        tryParseIdentToken,
        (ident): IdentPseudoElementArgument => ({
          type: PseudoElementArgumentKind.Ident,
          value: ident.value,
        }),
      );

    case PseudoElementArgumentKind.SelectorList:
      return parseWholePseudoElementArgument(
        value,
        tryParseSelectorList,
        (selectors): SelectorListPseudoElementArgument => ({
          type: PseudoElementArgumentKind.SelectorList,
          selectors,
        }),
      );

    case PseudoElementArgumentKind.Raw:
      return {
        type: PseudoElementArgumentKind.Raw,
        value,
      };
  }
}
