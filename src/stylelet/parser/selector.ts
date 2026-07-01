import { asciiLower } from '../../utils/css';
import {
  any, commaRepeat, one, oneOf, opt, plus, sequenceOf, withComponentTrivia, requiredSequenceOf,
  type TryComponentParser,
} from './component-grammar';
import { ComponentCursor } from './component-cursor';
import type { ComponentValue, FunctionBlock } from './syntax';
import {
  consumeComponentTrivia, isBracketBlock, isDelimToken, isFunctionBlock, isIdentToken, isTokenKind,
  parseAsComponentGrammar,
  parseListAsComponentGrammar,
} from './syntax';
import type { HashToken, StringToken } from './tokens';
import { HashTokenFlag, type IdentToken, TokenKind } from './tokens';
import type {
  AnPlusBPseudoClassArgument, ComplexRealSelectorListPseudoClassArgument, CompoundSelectorPseudoClassArgument, CompoundSelectorPseudoElementArgument, CustomIdentPseudoElementArgument, DirectionPseudoClassArgument, ForgivingSelectorListPseudoClassArgument,
  LanguageRange,
  LanguageRangeListPseudoClassArgument,
  PartNameListPseudoElementArgument,
  PseudoClassArgument, PseudoElementArgument, RelativeSelectorListPseudoClassArgument,
  SelectorListPseudoElementArgument,
} from './selector-pseudo';
import { PSEUDO_CLASSES, PSEUDO_ELEMENTS, PseudoClassArgumentKind, PseudoElementArgumentKind } from './selector-pseudo';
import {
  listSpecificity, SpecificityB, SpecificityA, SpecificityC, Specificity0, sumSpecificity, type Specificity,
} from './selector-specificity';
import { assertNever } from '../../utils/util';
import { tryParseCustomIdent } from '../values/custom-ident';

export enum SelectorKind {
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

const parseSelectorList: TryComponentParser<SelectorList> =
  tryParseComplexSelectorList;

/**
 * <complex-selector-list> = <complex-selector>#
 */
export type ComplexSelectorList = {
  kind: SelectorKind.ComplexSelectorList;
  arms: ComplexSelector[];
  specificity: Specificity;
}

function tryParseComplexSelectorList(c: ComponentCursor): ComplexSelectorList | null {
  const arms = parseComplexSelectorListArms(c);
  if (arms === null) return null;

  return {
    kind: SelectorKind.ComplexSelectorList,
    arms,
    specificity: listSpecificity(arms),
  };
}

const parseComplexSelectorListArms: TryComponentParser<ComplexSelector[]> =
  commaRepeat(tryParseComplexSelector);

/**
 * <complex-real-selector-list> = <complex-real-selector>#
 */
export type ComplexRealSelectorList = {
  kind: SelectorKind.ComplexRealSelectorList;
  arms: ComplexRealSelector[];
  specificity: Specificity;
}

export function tryParseComplexRealSelectorList(c: ComponentCursor): ComplexRealSelectorList | null {
  const arms = parseComplexRealSelectorListArms(c);
  if (arms === null) return null;

  return {
    kind: SelectorKind.ComplexRealSelectorList,
    arms,
    specificity: listSpecificity(arms),
  };
}

const parseComplexRealSelectorListArms: TryComponentParser<ComplexRealSelector[]> =
  commaRepeat(tryParseComplexRealSelector);

/**
 * <compound-selector-list> = <compound-selector>#
 */
export type CompoundSelectorList = {
  kind: SelectorKind.CompoundSelectorList;
  arms: CompoundSelector[];
  specificity: Specificity;
}

export function tryParseCompoundSelectorList(c: ComponentCursor): CompoundSelectorList | null {
  const arms = parseCompoundSelectorListArms(c);
  if (arms === null) return null;

  return {
    kind: SelectorKind.CompoundSelectorList,
    arms,
    specificity: listSpecificity(arms),
  };
}

const parseCompoundSelectorListArms: TryComponentParser<CompoundSelector[]> =
  commaRepeat(tryParseCompoundSelector);

/**
 * <simple-selector-list> = <simple-selector>#
 */
export type SimpleSelectorList = {
  kind: SelectorKind.SimpleSelectorList;
  arms: SimpleSelector[];
  specificity: Specificity;
}

export function tryParseSimpleSelectorList(c: ComponentCursor): SimpleSelectorList | null {
  const arms = parseSimpleSelectorListArms(c);
  if (arms === null) return null;

  return {
    kind: SelectorKind.SimpleSelectorList,
    arms,
    specificity: listSpecificity(arms),
  };
}

const parseSimpleSelectorListArms: TryComponentParser<SimpleSelector[]> =
  commaRepeat(tryParseSimpleSelector);

/**
 * <relative-selector-list> = <relative-selector>#
 */
export type RelativeSelectorList = {
  kind: SelectorKind.RelativeSelectorList;
  arms: RelativeSelector[];
  specificity: Specificity;
}

export function tryParseRelativeSelectorList(c: ComponentCursor): RelativeSelectorList | null {
  const arms = parseRelativeSelectorListArms(c);
  if (arms === null) return null;

  return {
    kind: SelectorKind.RelativeSelectorList,
    arms,
    specificity: listSpecificity(arms),
  };
}

const parseRelativeSelectorListArms: TryComponentParser<RelativeSelector[]> =
  commaRepeat(tryParseRelativeSelector);

/**
 * <relative-real-selector-list> = <relative-real-selector>#
 */
export type RelativeRealSelectorList = {
  kind: SelectorKind.RelativeRealSelectorList;
  arms: RelativeRealSelector[];
  specificity: Specificity;
}

export function tryParseRelativeRealSelectorList(c: ComponentCursor): RelativeRealSelectorList | null {
  const arms = parseRelativeRealSelectorListArms(c);
  if (arms === null) return null;

  return {
    kind: SelectorKind.RelativeRealSelectorList,
    arms,
    specificity: listSpecificity(arms),
  };
}

const parseRelativeRealSelectorListArms: TryComponentParser<RelativeRealSelector[]> =
  commaRepeat(tryParseRelativeRealSelector);

/**
 * <complex-selector> =
 *   <complex-selector-unit> [ <combinator>? <complex-selector-unit> ]*
 */
export type ComplexSelector = {
  kind: SelectorKind.ComplexSelector;
  parts: {
    combinator: Combinator | null;
    unit: ComplexSelectorUnit;
  }[];
  specificity: Specificity;
};

function tryParseComplexSelector(c: ComponentCursor): ComplexSelector | null {
  return parseComplexSelector(c);
}

const parseComplexSelector: TryComponentParser<ComplexSelector> = sequenceOf(
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
    kind: SelectorKind.ComplexSelector,
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
  kind: SelectorKind.ComplexSelectorUnit;
  compound: CompoundSelector | null;
  pseudoCompounds: PseudoCompoundSelector[];
  specificity: Specificity;
};

function tryParseComplexSelectorUnit(c: ComponentCursor): ComplexSelectorUnit | null {
  return parseComplexSelectorUnit(c);
}

const parseComplexSelectorUnit: TryComponentParser<ComplexSelectorUnit> = requiredSequenceOf(
  opt(tryParseCompoundSelector),
  any(tryParsePseudoCompoundSelector),

  ([[compound], pseudoCompounds]): ComplexSelectorUnit => ({
    kind: SelectorKind.ComplexSelectorUnit,
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
  kind: SelectorKind.ComplexRealSelector;
  parts: {
    combinator: Combinator | null;
    compound: CompoundSelector;
  }[];
  specificity: Specificity;
};

function tryParseComplexRealSelector(c: ComponentCursor): ComplexRealSelector | null {
  return parseComplexRealSelector(c);
}

const parseComplexRealSelector: TryComponentParser<ComplexRealSelector> = sequenceOf(
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
    kind: SelectorKind.ComplexRealSelector,
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
  kind: SelectorKind.RelativeSelector;
  combinator: Combinator | null;
  selector: ComplexSelector;
  specificity: Specificity;
};

export function tryParseRelativeSelector(c: ComponentCursor): RelativeSelector | null {
  return parseRelativeSelector(c);
}

const parseRelativeSelector: TryComponentParser<RelativeSelector> = sequenceOf(
  opt(tryParseCombinator),
  one(tryParseComplexSelector),

  ([combinator, [selector]]): RelativeSelector => ({
    kind: SelectorKind.RelativeSelector,
    combinator: combinator[0] ?? null,
    selector,
    specificity: selector.specificity,
  }),
);

/**
 * <relative-real-selector> = <combinator>? <complex-real-selector>
 */
export type RelativeRealSelector = {
  kind: SelectorKind.RelativeRealSelector;
  combinator: Combinator | null;
  selector: ComplexRealSelector;
  specificity: Specificity;
};

export function tryParseRelativeRealSelector(c: ComponentCursor): RelativeRealSelector | null {
  return parseRelativeRealSelector(c);
}

const parseRelativeRealSelector: TryComponentParser<RelativeRealSelector> = sequenceOf(
  opt(tryParseCombinator),
  one(tryParseComplexRealSelector),

  ([combinator, [selector]]): RelativeRealSelector => ({
    kind: SelectorKind.RelativeRealSelector,
    combinator: combinator[0] ?? null,
    selector,
    specificity: selector.specificity,
  }),
);

/**
 * <compound-selector> = [ <type-selector>? <subclass-selector>* ]!
 */
export type CompoundSelector = {
  kind: SelectorKind.CompoundSelector;
  typeSelector: TypeSelector | null;
  subclasses: SubclassSelector[];
  specificity: Specificity;
};

function tryParseCompoundSelector(c: ComponentCursor): CompoundSelector | null {
  return parseCompoundSelector(c);
}

const parseCompoundSelector: TryComponentParser<CompoundSelector> = requiredSequenceOf(
  opt(tryParseTypeSelector),
  any(tryParseSubclassSelector),

  ([[typeSelector], subclasses]): CompoundSelector => ({
    kind: SelectorKind.CompoundSelector,
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
  kind: SelectorKind.PseudoCompoundSelector;
  pseudoElement: PseudoElementSelector;
  pseudoClasses: PseudoClassSelector[];
  specificity: Specificity;
};

function tryParsePseudoCompoundSelector(c: ComponentCursor): PseudoCompoundSelector | null {
  return parsePseudoCompoundSelector(c);
}

const parsePseudoCompoundSelector: TryComponentParser<PseudoCompoundSelector> = sequenceOf(
  one(tryParsePseudoElementSelector),
  any(tryParsePseudoClassSelector),

  ([[pseudoElement], pseudoClasses]): PseudoCompoundSelector => ({
    kind: SelectorKind.PseudoCompoundSelector,
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

const parseSimpleSelector: TryComponentParser<SimpleSelector> = oneOf(
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

const parseCombinator: TryComponentParser<Combinator> = (c) => {
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
  namespace: string | null;
  name: string;
};

function tryParseWqName(c: ComponentCursor): WqName | null {
  return parseWqName(c);
}

const parseWqName: TryComponentParser<WqName> = sequenceOf(
  opt(tryParseNsPrefix),
  one(tryParseIdentToken),

  ([namespace, [name]]): WqName => ({
    namespace: namespace[0] ?? null,
    name: name.value,
  }),
);

/**
 * <ns-prefix> = [ <ident-token> | '*' ]? '|'
 */
function tryParseNsPrefix(c: ComponentCursor): string | null {
  return parseNsPrefix(c);
}

const tryParseStarDelim = createDelimParser('*');
const tryParsePipeDelim = createDelimParser('|');

const parseNsPrefix: TryComponentParser<string> = sequenceOf(
  opt(
    oneOf(
      one(tryParseIdentToken),
      one(tryParseStarDelim),

      ([prefix]) => (
        typeof prefix === 'string'
          ? prefix
          : prefix.value
      ),
    ),
  ),
  one(tryParsePipeDelim),

  ([prefix]): string => prefix[0] ?? '',
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
  kind: SelectorKind.TypeSelector;
  namespace: string | null;
  name: string;
  specificity: Specificity;
};

function tryParseTypeSelector(c: ComponentCursor): TypeSelector | null {
  return parseTypeSelector(c);
}

const parseTypeSelector: TryComponentParser<TypeSelector> = sequenceOf(
  opt(tryParseNsPrefix),

  one(
    oneOf(
      one(tryParseIdentToken),
      one(tryParseStarDelim),

      ([name]): string => (
        typeof name === 'string'
          ? name
          : name.value
      ),
    ),
  ),

  ([namespace, [name]]): TypeSelector => ({
    kind: SelectorKind.TypeSelector,
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

const parseSubclassSelector: TryComponentParser<SubclassSelector> = oneOf(
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
  kind: SelectorKind.IdSelector;
  name: string;
  specificity: Specificity;
};

function tryParseIdSelector(c: ComponentCursor): IdSelector | null {
  return parseIdSelector(c);
}

const parseIdSelector: TryComponentParser<IdSelector> = sequenceOf(
  one(tryParseIdHashToken),

  ([[hash]]): IdSelector => ({
    kind: SelectorKind.IdSelector,
    name: hash.value,
    specificity: SpecificityA,
  }),
);

/**
 * <class-selector> = '.' <ident-token>
 */
export type ClassSelector = {
  kind: SelectorKind.ClassSelector;
  name: string;
  specificity: Specificity;
};

function tryParseClassSelector(c: ComponentCursor): ClassSelector | null {
  return parseClassSelector(c);
}

const tryParseDotDelim = createDelimParser('.');

const parseClassSelector: TryComponentParser<ClassSelector> = sequenceOf(
  one(tryParseDotDelim),
  one(tryParseIdentToken),

  ([, [ident]]): ClassSelector => ({
    kind: SelectorKind.ClassSelector,
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
  kind: SelectorKind.AttributeSelector;
  name: WqName;
  matcher: AttrMatcher | null;
  value: string | null;
  modifier: AttrModifier | null;
  specificity: Specificity;
};

function tryParseAttributeSelector(c: ComponentCursor): AttributeSelector | null {
  return parseAttributeSelector(c);
}

const parseAttributeSelectorBody: TryComponentParser<AttributeSelector> = oneOf(
  one(
    sequenceOf(
      one(withComponentTrivia(tryParseWqName)),
      one(withComponentTrivia(tryParseAttrMatcher)),
      one(withComponentTrivia(tryParseAttrValue)),
      opt(withComponentTrivia(tryParseAttrModifier)),

      ([[name], [matcher], [value], modifier]): AttributeSelector => ({
        kind: SelectorKind.AttributeSelector,
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
        kind: SelectorKind.AttributeSelector,
        name,
        matcher: null,
        value: null,
        modifier: null,
        specificity: SpecificityB,
      }),
    ),
  ),

  ([selector]): AttributeSelector => selector,
);

const parseAttributeSelector: TryComponentParser<AttributeSelector> = (c) => {
  const start = c.pos();
  const block = c.next();

  if (!isBracketBlock(block)) {
    c.restore(start);
    return null;
  }

  const inner = new ComponentCursor(block.value);
  const selector = parseAttributeSelectorBody(inner);

  if (selector === null) {
    c.restore(start);
    return null;
  }

  consumeComponentTrivia(inner);

  if (inner.peek() !== null) {
    c.restore(start);
    return null;
  }

  return selector;
};

/**
 * <attr-matcher> = [ '~' | '|' | '^' | '$' | '*' ]? '='
 */
export type AttrMatcher = '=' | '~=' | '|=' | '^=' | '$=' | '*=';

function tryParseAttrMatcher(c: ComponentCursor): AttrMatcher | null {
  return parseAttrMatcher(c);
}

const parseAttrMatcher: TryComponentParser<AttrMatcher> = (c) => {
  const start = c.pos();
  const first = c.next();

  if (isDelimToken(first, '=')) {
    return '=';
  }

  let prefix: '~' | '|' | '^' | '$' | '*' | null = null;

  if (isDelimToken(first, '~')) prefix = '~';
  else if (isDelimToken(first, '|')) prefix = '|';
  else if (isDelimToken(first, '^')) prefix = '^';
  else if (isDelimToken(first, '$')) prefix = '$';
  else if (isDelimToken(first, '*')) prefix = '*';

  if (prefix !== null && isDelimToken(c.next(), '=')) {
    return `${prefix}=`;
  }

  c.restore(start);
  return null;
};

// type AttrMatcherPrefix = '~' | '|' | '^' | '$' | '*';

// const parseAttrMatcherPrefix: TryValueParser<AttrMatcherPrefix> = oneOf(
//   one(delim('~')),
//   one(delim('|')),
//   one(delim('^')),
//   one(delim('$')),
//   one(delim('*')),

//   ([prefix]) => prefix,
// );

// const parseAttrMatcher: TryValueParser<AttrMatcher> = sequenceOf(
//   opt(parseAttrMatcherPrefix),
//   one(delim('=')),

//   ([prefix]): AttrMatcher =>
//     `${prefix[0] ?? ''}=`,
// );

/**
 * [ <string-token> | <ident-token> ]
 */

function tryParseAttrValue(c: ComponentCursor): string | null {
  return parseAttrValue(c);
}

const parseAttrValue: TryComponentParser<string> = oneOf(
  one(tryParseStringToken),
  one(tryParseIdentToken),

  ([token]): string => token.value,
);

/**
 * <attr-modifier> = i | s
 */
export type AttrModifier = 'i' | 's';

function tryParseAttrModifier(c: ComponentCursor): AttrModifier | null {
  return parseAttrModifier(c);
}

const parseAttrModifier: TryComponentParser<AttrModifier> = (c) => {
  const start = c.pos();
  const ident = tryParseIdentToken(c);

  if (ident === null) {
    return null;
  }

  const value = asciiLower(ident.value);

  if (value === 'i' || value === 's') {
    return value;
  }

  c.restore(start);
  return null;
};

// const parseAttrModifier: TryValueParser<AttrModifier> = oneOf(
//   one(identValue('i')),
//   one(identValue('s')),

//   ([modifier]): AttrModifier => modifier,
// );

/**
 * <pseudo-class-selector> =
 *   : <ident-token> |
 *   : <function-token> <any-value> )
 */
export type PseudoClassSelector = {
  kind: SelectorKind.PseudoClassSelector;
  name: string;
  argument: PseudoClassArgument | null;
  specificity: Specificity;
};

function tryParsePseudoClassSelector(c: ComponentCursor): PseudoClassSelector | null {
  return parsePseudoClassSelector(c);
}

const parsePseudoClassSelector: TryComponentParser<PseudoClassSelector> = oneOf(
  one(
    sequenceOf(
      one(tryParseColon),
      one(tryParseIdentToken),

      ([, [ident]]): PseudoClassSelector | null =>
        createPseudoClassSelector(ident.value, null),
    ),
  ),

  one(
    sequenceOf(
      one(tryParseColon),
      one(tryParseFunctionBlock),

      ([, [fn]]): PseudoClassSelector | null =>
        createPseudoClassSelector(fn.name, fn.value),
    ),
  ),

  ([selector]): PseudoClassSelector | null => selector,
);

/**
 * <pseudo-element-selector> =
 *   : <pseudo-class-selector> | <legacy-pseudo-element-selector>
 */
export type PseudoElementSelector = {
  kind: SelectorKind.PseudoElementSelector;
  name: string;
  argument: PseudoElementArgument | null;
  specificity: Specificity;
};

function tryParsePseudoElementSelector(c: ComponentCursor): PseudoElementSelector | null {
  return parsePseudoElementSelector(c);
}

const parsePseudoElementSelector: TryComponentParser<PseudoElementSelector> = oneOf(
  one(
    sequenceOf(
      one(tryParseLegacyPseudoElementName),

      ([[name]]): PseudoElementSelector | null =>
        createPseudoElementSelector(name, null, true),
    ),
  ),

  one(
    sequenceOf(
      one(tryParseColon),
      one(tryParseColon),
      one(tryParseIdentToken),

      ([, , [ident]]): PseudoElementSelector | null =>
        createPseudoElementSelector(ident.value, null, false),
    ),
  ),

  one(
    sequenceOf(
      one(tryParseColon),
      one(tryParseColon),
      one(tryParseFunctionBlock),

      ([, , [fn]]): PseudoElementSelector | null =>
        createPseudoElementSelector(fn.name, fn.value, false),
    ),
  ),

  ([selector]): PseudoElementSelector | null => selector,
);

/**
 * <legacy-pseudo-element-selector> =
 *   : [before | after | first-line | first-letter]
 */
type LegacyPseudoElementName =
  | 'before'
  | 'after'
  | 'first-line'
  | 'first-letter';

function tryParseLegacyPseudoElementName(c: ComponentCursor): LegacyPseudoElementName | null {
  return parseLegacyPseudoElementName(c);
}

const parseLegacyPseudoElementName: TryComponentParser<LegacyPseudoElementName> = (c) => {
  const start = c.pos();

  if (tryParseColon(c) === null) {
    return null;
  }

  const ident = tryParseIdentToken(c);

  if (ident === null) {
    c.restore(start);
    return null;
  }

  const name = asciiLower(ident.value);

  if (!isLegacyPseudoElementName(name)) {
    c.restore(start);
    return null;
  }

  return name;
};

function isLegacyPseudoElementName(value: string): value is LegacyPseudoElementName {
  return (
    value === 'before' || value === 'after' || value === 'first-line' || value === 'first-letter'
  );
}

// const parseLegacyPseudoElementName: TryValueParser<LegacyPseudoElementName> = sequenceOf(
//   one(tryParseColon),
//   one(
//     oneOf(
//       one(identValue('before')),
//       one(identValue('after')),
//       one(identValue('first-line')),
//       one(identValue('first-letter')),

//       ([name]) => name,
//     ),
//   ),

//   ([, [name]]): LegacyPseudoElementName => name,
// );

// Helpers and simple parsers

function tryParseColon(c: ComponentCursor): ':' | null {
  return c.match(TokenKind.Colon) ? ':' : null;
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

function createDelimParser<T extends string>(expected: T): TryComponentParser<T> {
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

// function identValue<T extends string>(expected: T): TryValueParser<T> {
//   return (c) => {
//     const start = c.pos();
//     const comp = c.next();

//     if (!isIdentTokenWithValue(comp, expected, true)) {
//       c.restore(start);
//       return null;
//     }

//     return expected;
//   };
// }

function createPseudoClassSelector(
  rawName: string,
  value: ComponentValue[] | null,
): PseudoClassSelector | null {
  const name = canonicalPseudoClassName(rawName);
  const def = PSEUDO_CLASSES[name];

  if (def === undefined) {
    return null;
  }

  if (value === null) {
    if (def.bare === undefined) {
      return null;
    }

    return {
      kind: SelectorKind.PseudoClassSelector,
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
    kind: SelectorKind.PseudoClassSelector,
    name,
    argument,
    specificity: def.functional.specificity(argument),
  };
}

// Removed/deferred Selectors Level 4 draft pseudo-classes.
// :target-within was removed in favor of :has(:target).
// :local-link, :blank, :interest-source, :interest-target,
// :nth-col(), :nth-last-col(), and time-dimensional pseudo-classes
// were deferred to Selectors Level 5.
// Drag-and-drop pseudo-classes such as :drop() were dropped.
const PSEUDO_CLASS_ALIASES: Record<string, string | undefined> = {
  matches: 'is',
  '-webkit-autofill': 'autofill',
};

function canonicalPseudoClassName(rawName: string): string {
  const name = asciiLower(rawName);
  return PSEUDO_CLASS_ALIASES[name] ?? name;
}

export function parsePseudoClassArgument(
  kind: PseudoClassArgumentKind,
  value: ComponentValue[],
): PseudoClassArgument | null {
  switch (kind) {
    case PseudoClassArgumentKind.ForgivingSelectorList:
      return parseForgivingSelectorListArgument(value);

    case PseudoClassArgumentKind.RelativeSelectorList:
      return parseWholeArgument(
        value,
        tryParseRelativeSelectorList,
        (selectors): RelativeSelectorListPseudoClassArgument => ({
          kind: PseudoClassArgumentKind.RelativeSelectorList,
          selectors,
        }),
      );

    case PseudoClassArgumentKind.ComplexRealSelectorList:
      return parseWholeArgument(
        value,
        tryParseComplexRealSelectorList,
        (selectors): ComplexRealSelectorListPseudoClassArgument => ({
          kind: PseudoClassArgumentKind.ComplexRealSelectorList,
          selectors,
        }),
      );

    case PseudoClassArgumentKind.CompoundSelector:
      return parseWholeArgument(
        value,
        tryParseCompoundSelector,
        (selector): CompoundSelectorPseudoClassArgument => ({
          kind: PseudoClassArgumentKind.CompoundSelector,
          selector,
        }),
      );

    case PseudoClassArgumentKind.AnPlusB:
      return parseWholeArgument(
        value,
        tryParseAnPlusB,
        (anb): AnPlusBPseudoClassArgument => ({
          kind: PseudoClassArgumentKind.AnPlusB,
          ...anb,
        }),
      );

    case PseudoClassArgumentKind.Direction:
      return parseWholeArgument(
        value,
        tryParseDirection,
        (direction): DirectionPseudoClassArgument => ({
          kind: PseudoClassArgumentKind.Direction,
          value: direction,
        }),
      );

    case PseudoClassArgumentKind.LanguageRangeList:
      return parseLanguageRangeListArgument(value);

    case PseudoClassArgumentKind.NthChild:
      return null;
  }
}

function parseForgivingSelectorListArgument(
  arg: ComponentValue[],
): ForgivingSelectorListPseudoClassArgument {
  const arms = parseListAsComponentGrammar(
    arg,
    withComponentTrivia(tryParseComplexRealSelector),
  ).filter((selector): selector is ComplexRealSelector => selector !== null);

  return {
    kind: PseudoClassArgumentKind.ForgivingSelectorList,
    selectors: {
      kind: SelectorKind.ComplexRealSelectorList,
      arms,
      specificity: listSpecificity(arms),
    },
  };
}

function parseWholeArgument<T, R>(
  value: ComponentValue[],
  parse: TryComponentParser<T>,
  create: (value: T) => R,
): R | null {
  const c = new ComponentCursor(value);
  const parsed = parse(c);

  if (parsed === null) {
    return null;
  }

  consumeComponentTrivia(c);

  if (c.peek() !== null) {
    return null;
  }

  return create(parsed);
}

function tryParseAnPlusB(_c: ComponentCursor): { a: number; b: number; } | null {
  return null; // TODO: Implement An+B parser
}

function parseLanguageRangeListArgument(
  value: ComponentValue[],
): LanguageRangeListPseudoClassArgument | null {
  const parsed = parseListAsComponentGrammar(
    value,
    withComponentTrivia(tryParseLanguageRange),
  );

  const ranges: LanguageRange[] = [];

  for (const range of parsed) {
    if (range === null) {
      return null;
    }

    ranges.push(range);
  }

  if (ranges.length === 0) {
    return null;
  }

  return {
    kind: PseudoClassArgumentKind.LanguageRangeList,
    ranges,
  };
}

function tryParseLanguageRange(c: ComponentCursor): LanguageRange | null {
  const start = c.pos();
  const component = c.next();

  if (isIdentToken(component)) {
    return component.value;
  }

  if (isTokenKind(component, TokenKind.String)) {
    return component.value;
  }

  c.restore(start);
  return null;
}

function tryParseDirection(c: ComponentCursor): string | null {
  const start = c.pos();
  const ident = c.next();

  if (!isIdentToken(ident)) {
    c.restore(start);
    return null;
  }

  return asciiLower(ident.value);
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

  if (value === null) {
    if (def.bare === undefined) {
      return null;
    }

    return {
      kind: SelectorKind.PseudoElementSelector,
      name,
      argument: null,
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
    kind: SelectorKind.PseudoElementSelector,
    name,
    argument,
    specificity: def.functional.specificity(argument),
  };
}

function parsePseudoElementArgument(
  kind: PseudoElementArgumentKind,
  value: ComponentValue[],
): PseudoElementArgument | null {
  switch (kind) {
    case PseudoElementArgumentKind.CompoundSelector:
      return parseWholeArgument(
        value,
        tryParseCompoundSelector,
        (selector): CompoundSelectorPseudoElementArgument => ({
          kind: PseudoElementArgumentKind.CompoundSelector,
          selector,
        }),
      );

    case PseudoElementArgumentKind.PartNameList:
      return parsePartNameListArgument(value);

    case PseudoElementArgumentKind.SelectorList:
      return parseWholeArgument(
        value,
        tryParseSelectorList,
        (selectors): SelectorListPseudoElementArgument => ({
          kind: PseudoElementArgumentKind.SelectorList,
          selectors,
        }),
      );

    case PseudoElementArgumentKind.CustomIdent:
      return parseWholeArgument(
        value,
        tryParseCustomIdent,
        (ident): CustomIdentPseudoElementArgument => ({
          kind: PseudoElementArgumentKind.CustomIdent,
          value: ident,
        }),
      );

    default: assertNever(kind);
  }
}

// function parsePartNameListArgument(
//   value: readonly ComponentValue[],
// ): PartNameListPseudoElementArgument | null {
//   const names = parseAsComponentGrammar(
//     value,
//     tryParsePartNameList,
//   );

//   if (names === null) {
//     return null;
//   }

//   return {
//     kind: PseudoElementArgumentKind.PartNameList,
//     names,
//   };
// }

const tryParsePartNameList = plus(
  withComponentTrivia((c): string | null => {
    const ident = tryParseIdentToken(c);
    return ident?.value ?? null;
  }),
);

function parsePartNameListArgument(
  value: readonly ComponentValue[],
): PartNameListPseudoElementArgument | null {
  const names = parseAsComponentGrammar(value, tryParsePartNameList);

  if (names === null) {
    return null;
  }

  return {
    kind: PseudoElementArgumentKind.PartNameList,
    names,
  };
}

// const tryParsePartNameList: TryComponentParser<string[]> = (c) => {
//   const names: string[] = [];

//   while (true) {
//     consumeComponentTrivia(c);

//     const ident = tryParseIdentToken(c);

//     if (ident === null) {
//       break;
//     }

//     names.push(ident.value);
//   }

//   return names.length > 0 ? names : null;
// };
