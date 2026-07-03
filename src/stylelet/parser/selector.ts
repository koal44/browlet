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
import {
  addSpecificity, listSpecificity, SpecificityB, SpecificityA, SpecificityC, Specificity0, sumSpecificity, type Specificity,
} from './selector-specificity';
import { parseCustomIdent, type CustomIdentValue } from '../values/custom-ident';

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

export type SelectorParseInput = string | readonly ComponentValue[];
export type SelectorParserContext = { foo?: 'bar'; } | null;

/**
 * 17.1. Parse a selector
 *
 * Spec hook. Despite the singular name, this parses as <selector-list>
 * and returns a complex selector list.
 */
export function parseSelector(
  input: SelectorParseInput,
  context: SelectorParserContext = null,
): SelectorList | null {
  return parseSelectorList(input, context);
}

/**
 * 17.2. Parse a relative selector
 *
 * Spec hook. Despite the singular name, this parses as <relative-selector-list>.
 */
export function parseRelativeSelector(
  input: SelectorParseInput,
  context: SelectorParserContext = null,
): RelativeSelectorList | null {
  return parseRelativeSelectorList(input, context);
}

/**
 * <selector-list> = <complex-selector-list>
 */
export type SelectorList = ComplexSelectorList;

export function parseSelectorList(
  input: SelectorParseInput,
  _context: SelectorParserContext = null,
): SelectorList | null {
  return parseAsComponentGrammar(input, tryConsumeSelectorList);
}

function tryConsumeSelectorList(c: ComponentCursor): SelectorList | null {
  return consumeSelectorList(c);
}

const consumeSelectorList: TryComponentParser<SelectorList> =
  tryConsumeComplexSelectorList;

/**
 * <complex-selector-list> = <complex-selector>#
 */
export type ComplexSelectorList = {
  kind: SelectorKind.ComplexSelectorList;
  arms: ComplexSelector[];
  specificity: Specificity;
};

export function parseComplexSelectorList(
  input: SelectorParseInput,
  _context: SelectorParserContext = null,
): ComplexSelectorList | null {
  return parseAsComponentGrammar(input, tryConsumeComplexSelectorList);
}

function tryConsumeComplexSelectorList(c: ComponentCursor): ComplexSelectorList | null {
  const arms = consumeComplexSelectorListArms(c);
  if (arms === null) return null;

  return {
    kind: SelectorKind.ComplexSelectorList,
    arms,
    specificity: listSpecificity(arms),
  };
}

const consumeComplexSelectorListArms: TryComponentParser<ComplexSelector[]> =
  commaRepeat(tryConsumeComplexSelector);

/**
 * <complex-real-selector-list> = <complex-real-selector>#
 */
export type ComplexRealSelectorList = {
  kind: SelectorKind.ComplexRealSelectorList;
  arms: ComplexRealSelector[];
  specificity: Specificity;
};

export function parseComplexRealSelectorList(
  input: SelectorParseInput,
  _context: SelectorParserContext = null,
): ComplexRealSelectorList | null {
  return parseAsComponentGrammar(input, tryConsumeComplexRealSelectorList);
}

function tryConsumeComplexRealSelectorList(c: ComponentCursor): ComplexRealSelectorList | null {
  const arms = consumeComplexRealSelectorListArms(c);
  if (arms === null) return null;

  return {
    kind: SelectorKind.ComplexRealSelectorList,
    arms,
    specificity: listSpecificity(arms),
  };
}

const consumeComplexRealSelectorListArms: TryComponentParser<ComplexRealSelector[]> =
  commaRepeat(tryConsumeComplexRealSelector);

/**
 * <compound-selector-list> = <compound-selector>#
 */
export type CompoundSelectorList = {
  kind: SelectorKind.CompoundSelectorList;
  arms: CompoundSelector[];
  specificity: Specificity;
};

export function parseCompoundSelectorList(
  input: SelectorParseInput,
  _context: SelectorParserContext = null,
): CompoundSelectorList | null {
  return parseAsComponentGrammar(input, tryConsumeCompoundSelectorList);
}

function tryConsumeCompoundSelectorList(c: ComponentCursor): CompoundSelectorList | null {
  const arms = consumeCompoundSelectorListArms(c);
  if (arms === null) return null;

  return {
    kind: SelectorKind.CompoundSelectorList,
    arms,
    specificity: listSpecificity(arms),
  };
}

const consumeCompoundSelectorListArms: TryComponentParser<CompoundSelector[]> =
  commaRepeat(tryConsumeCompoundSelector);

/**
 * <simple-selector-list> = <simple-selector>#
 */
export type SimpleSelectorList = {
  kind: SelectorKind.SimpleSelectorList;
  arms: SimpleSelector[];
  specificity: Specificity;
};

export function parseSimpleSelectorList(
  input: SelectorParseInput,
  _context: SelectorParserContext = null,
): SimpleSelectorList | null {
  return parseAsComponentGrammar(input, tryConsumeSimpleSelectorList);
}

function tryConsumeSimpleSelectorList(c: ComponentCursor): SimpleSelectorList | null {
  const arms = consumeSimpleSelectorListArms(c);
  if (arms === null) return null;

  return {
    kind: SelectorKind.SimpleSelectorList,
    arms,
    specificity: listSpecificity(arms),
  };
}

const consumeSimpleSelectorListArms: TryComponentParser<SimpleSelector[]> =
  commaRepeat(tryConsumeSimpleSelector);

/**
 * <relative-selector-list> = <relative-selector>#
 */
export type RelativeSelectorList = {
  kind: SelectorKind.RelativeSelectorList;
  arms: RelativeSelector[];
  specificity: Specificity;
};

export function parseRelativeSelectorList(
  input: SelectorParseInput,
  _context: SelectorParserContext = null,
): RelativeSelectorList | null {
  return parseAsComponentGrammar(input, tryConsumeRelativeSelectorList);
}

function tryConsumeRelativeSelectorList(c: ComponentCursor): RelativeSelectorList | null {
  const arms = consumeRelativeSelectorListArms(c);
  if (arms === null) return null;

  return {
    kind: SelectorKind.RelativeSelectorList,
    arms,
    specificity: listSpecificity(arms),
  };
}

const consumeRelativeSelectorListArms: TryComponentParser<RelativeSelector[]> =
  commaRepeat(tryConsumeRelativeSelector);

/**
 * <relative-real-selector-list> = <relative-real-selector>#
 */
export type RelativeRealSelectorList = {
  kind: SelectorKind.RelativeRealSelectorList;
  arms: RelativeRealSelector[];
  specificity: Specificity;
};

export function parseRelativeRealSelectorList(
  input: SelectorParseInput,
  _context: SelectorParserContext = null,
): RelativeRealSelectorList | null {
  return parseAsComponentGrammar(input, tryConsumeRelativeRealSelectorList);
}

function tryConsumeRelativeRealSelectorList(c: ComponentCursor): RelativeRealSelectorList | null {
  const arms = consumeRelativeRealSelectorListArms(c);
  if (arms === null) return null;

  return {
    kind: SelectorKind.RelativeRealSelectorList,
    arms,
    specificity: listSpecificity(arms),
  };
}

const consumeRelativeRealSelectorListArms: TryComponentParser<RelativeRealSelector[]> =
  commaRepeat(tryConsumeRelativeRealSelector);

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

export function parseComplexSelector(
  input: SelectorParseInput,
  _context: SelectorParserContext = null,
): ComplexSelector | null {
  return parseAsComponentGrammar(input, tryConsumeComplexSelector);
}

function tryConsumeComplexSelector(c: ComponentCursor): ComplexSelector | null {
  return consumeComplexSelector(c);
}

const consumeComplexSelector: TryComponentParser<ComplexSelector> = sequenceOf(
  one(tryConsumeComplexSelectorUnit),

  any(
    sequenceOf(
      one(tryConsumeCombinator),
      one(tryConsumeComplexSelectorUnit),
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

function tryConsumeComplexSelectorUnit(c: ComponentCursor): ComplexSelectorUnit | null {
  return consumeComplexSelectorUnit(c);
}

const consumeComplexSelectorUnit: TryComponentParser<ComplexSelectorUnit> = requiredSequenceOf(
  opt(tryConsumeCompoundSelector),
  any(tryConsumePseudoCompoundSelector),

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

export function parseComplexRealSelector(
  input: SelectorParseInput,
  _context: SelectorParserContext = null,
): ComplexRealSelector | null {
  return parseAsComponentGrammar(input, tryConsumeComplexRealSelector);
}

function tryConsumeComplexRealSelector(c: ComponentCursor): ComplexRealSelector | null {
  return consumeComplexRealSelector(c);
}

const consumeComplexRealSelector: TryComponentParser<ComplexRealSelector> = sequenceOf(
  one(tryConsumeCompoundSelector),

  any(
    sequenceOf(
      one(tryConsumeCombinator),
      one(tryConsumeCompoundSelector),
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

function tryConsumeRelativeSelector(c: ComponentCursor): RelativeSelector | null {
  return consumeRelativeSelector(c);
}

const consumeRelativeSelector: TryComponentParser<RelativeSelector> = sequenceOf(
  opt(tryConsumeCombinator),
  one(tryConsumeComplexSelector),

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

function tryConsumeRelativeRealSelector(c: ComponentCursor): RelativeRealSelector | null {
  return consumeRelativeRealSelector(c);
}

const consumeRelativeRealSelector: TryComponentParser<RelativeRealSelector> = sequenceOf(
  opt(tryConsumeCombinator),
  one(tryConsumeComplexRealSelector),

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

export function parseCompoundSelector(
  input: SelectorParseInput,
  _context: SelectorParserContext = null,
): CompoundSelector | null {
  return parseAsComponentGrammar(input, tryConsumeCompoundSelector);
}

function tryConsumeCompoundSelector(c: ComponentCursor): CompoundSelector | null {
  return consumeCompoundSelector(c);
}

const consumeCompoundSelector: TryComponentParser<CompoundSelector> = requiredSequenceOf(
  opt(tryConsumeTypeSelector),
  any(tryConsumeSubclassSelector),

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

function tryConsumePseudoCompoundSelector(c: ComponentCursor): PseudoCompoundSelector | null {
  return consumePseudoCompoundSelector(c);
}

const consumePseudoCompoundSelector: TryComponentParser<PseudoCompoundSelector> = sequenceOf(
  one(tryConsumePseudoElementSelector),
  any(tryConsumePseudoClassSelector),

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

export function parseSimpleSelector(
  input: SelectorParseInput,
  _context: SelectorParserContext = null,
): SimpleSelector | null {
  return parseAsComponentGrammar(input, tryConsumeSimpleSelector);
}

function tryConsumeSimpleSelector(c: ComponentCursor): SimpleSelector | null {
  return consumeSimpleSelector(c);
}

const consumeSimpleSelector: TryComponentParser<SimpleSelector> = oneOf(
  one(tryConsumeTypeSelector),
  one(tryConsumeSubclassSelector),

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

function tryConsumeCombinator(c: ComponentCursor): Combinator | null {
  return consumeCombinator(c);
}

const consumeCombinator: TryComponentParser<Combinator> = (c) => {
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

function tryConsumeWqName(c: ComponentCursor): WqName | null {
  return consumeWqName(c);
}

const consumeWqName: TryComponentParser<WqName> = sequenceOf(
  opt(tryConsumeNsPrefix),
  one(tryConsumeIdentToken),

  ([namespace, [name]]): WqName => ({
    namespace: namespace[0] ?? null,
    name: name.value,
  }),
);

/**
 * <ns-prefix> = [ <ident-token> | '*' ]? '|'
 */
function tryConsumeNsPrefix(c: ComponentCursor): string | null {
  return consumeNsPrefix(c);
}

const tryConsumeStarDelim = createDelimConsumer('*');
const tryConsumePipeDelim = createDelimConsumer('|');

const consumeNsPrefix: TryComponentParser<string> = sequenceOf(
  opt(
    oneOf(
      one(tryConsumeIdentToken),
      one(tryConsumeStarDelim),

      ([prefix]) => (
        typeof prefix === 'string'
          ? prefix
          : prefix.value
      ),
    ),
  ),
  one(tryConsumePipeDelim),

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

function tryConsumeTypeSelector(c: ComponentCursor): TypeSelector | null {
  return consumeTypeSelector(c);
}

const consumeTypeSelector: TryComponentParser<TypeSelector> = sequenceOf(
  opt(tryConsumeNsPrefix),

  one(
    oneOf(
      one(tryConsumeIdentToken),
      one(tryConsumeStarDelim),

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

function tryConsumeSubclassSelector(c: ComponentCursor): SubclassSelector | null {
  return consumeSubclassSelector(c);
}

const consumeSubclassSelector: TryComponentParser<SubclassSelector> = oneOf(
  one(tryConsumeIdSelector),
  one(tryConsumeClassSelector),
  one(tryConsumeAttributeSelector),
  one(tryConsumePseudoClassSelector),

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

function tryConsumeIdSelector(c: ComponentCursor): IdSelector | null {
  return consumeIdSelector(c);
}

const consumeIdSelector: TryComponentParser<IdSelector> = sequenceOf(
  one(tryConsumeIdHashToken),

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

function tryConsumeClassSelector(c: ComponentCursor): ClassSelector | null {
  return consumeClassSelector(c);
}

const tryConsumeDotDelim = createDelimConsumer('.');

const consumeClassSelector: TryComponentParser<ClassSelector> = sequenceOf(
  one(tryConsumeDotDelim),
  one(tryConsumeIdentToken),

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

function tryConsumeAttributeSelector(c: ComponentCursor): AttributeSelector | null {
  return consumeAttributeSelector(c);
}

const consumeAttributeSelectorBody: TryComponentParser<AttributeSelector> = oneOf(
  one(
    sequenceOf(
      one(withComponentTrivia(tryConsumeWqName)),
      one(withComponentTrivia(tryConsumeAttrMatcher)),
      one(withComponentTrivia(tryConsumeAttrValue)),
      opt(withComponentTrivia(tryConsumeAttrModifier)),

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
      one(withComponentTrivia(tryConsumeWqName)),

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

const consumeAttributeSelector: TryComponentParser<AttributeSelector> = (c) => {
  const start = c.pos();
  const block = c.next();

  if (!isBracketBlock(block)) {
    c.restore(start);
    return null;
  }

  const inner = new ComponentCursor(block.value);
  const selector = consumeAttributeSelectorBody(inner);

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

function tryConsumeAttrMatcher(c: ComponentCursor): AttrMatcher | null {
  return consumeAttrMatcher(c);
}

const consumeAttrMatcher: TryComponentParser<AttrMatcher> = (c) => {
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


/**
 * <attr-value> = [ <string-token> | <ident-token> ]
 */
function tryConsumeAttrValue(c: ComponentCursor): string | null {
  return consumeAttrValue(c);
}

const consumeAttrValue: TryComponentParser<string> = oneOf(
  one(tryConsumeStringToken),
  one(tryConsumeIdentToken),

  ([token]): string => token.value,
);

/**
 * <attr-modifier> = i | s
 */
export type AttrModifier = 'i' | 's';

function tryConsumeAttrModifier(c: ComponentCursor): AttrModifier | null {
  return consumeAttrModifier(c);
}

const consumeAttrModifier: TryComponentParser<AttrModifier> = (c) => {
  const start = c.pos();
  const ident = tryConsumeIdentToken(c);

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
  isFeatureless: PseudoFeatureless;
};

function tryConsumePseudoClassSelector(c: ComponentCursor): PseudoClassSelector | null {
  return consumePseudoClassSelector(c);
}

const consumePseudoClassSelector: TryComponentParser<PseudoClassSelector> = oneOf(
  one(
    sequenceOf(
      one(tryConsumeColon),
      one(tryConsumeIdentToken),

      ([, [ident]]): PseudoClassSelector | null =>
        createPseudoClassSelector(ident.value, null),
    ),
  ),

  one(
    sequenceOf(
      one(tryConsumeColon),
      one(tryConsumeFunctionBlock),

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
  isFeatureless: PseudoFeatureless;
};

function tryConsumePseudoElementSelector(c: ComponentCursor): PseudoElementSelector | null {
  return consumePseudoElementSelector(c);
}

const consumePseudoElementSelector: TryComponentParser<PseudoElementSelector> = oneOf(
  one(
    sequenceOf(
      one(tryConsumeLegacyPseudoElementName),

      ([[name]]): PseudoElementSelector | null =>
        createPseudoElementSelector(name, null, true),
    ),
  ),

  one(
    sequenceOf(
      one(tryConsumeColon),
      one(tryConsumeColon),
      one(tryConsumeIdentToken),

      ([, , [ident]]): PseudoElementSelector | null =>
        createPseudoElementSelector(ident.value, null, false),
    ),
  ),

  one(
    sequenceOf(
      one(tryConsumeColon),
      one(tryConsumeColon),
      one(tryConsumeFunctionBlock),

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

function tryConsumeLegacyPseudoElementName(c: ComponentCursor): LegacyPseudoElementName | null {
  return consumeLegacyPseudoElementName(c);
}

const consumeLegacyPseudoElementName: TryComponentParser<LegacyPseudoElementName> = (c) => {
  const start = c.pos();

  if (tryConsumeColon(c) === null) {
    return null;
  }

  const ident = tryConsumeIdentToken(c);

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

// Token and delimiter consumers

function tryConsumeColon(c: ComponentCursor): ':' | null {
  return c.match(TokenKind.Colon) ? ':' : null;
}

function tryConsumeIdentToken(c: ComponentCursor): IdentToken | null {
  const start = c.pos();
  const comp = c.next();

  if (!isIdentToken(comp)) {
    c.restore(start);
    return null;
  }

  return comp;
}

function tryConsumeStringToken(c: ComponentCursor): StringToken | null {
  const start = c.pos();
  const comp = c.next();

  if (!isTokenKind(comp, TokenKind.String)) {
    c.restore(start);
    return null;
  }

  return comp;
}

function tryConsumeIdHashToken(c: ComponentCursor): HashToken | null {
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

function tryConsumeFunctionBlock(c: ComponentCursor): FunctionBlock | null {
  const start = c.pos();
  const comp = c.next();

  if (!isFunctionBlock(comp)) {
    c.restore(start);
    return null;
  }

  return comp;
}

function createDelimConsumer<T extends string>(expected: T): TryComponentParser<T> {
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

function createIdentValueConsumer<T extends string>(
  expected: T,
): TryComponentParser<T> {
  return (c) => {
    const start = c.pos();
    const ident = tryConsumeIdentToken(c);

    if (ident === null) {
      c.restore(start);
      return null;
    }

    if (asciiLower(ident.value) !== expected) {
      c.restore(start);
      return null;
    }

    return expected;
  };
}

export enum PseudoFeatureless {
  False = 'false',
  True = 'true',
  Maybe = 'maybe',
}

function createPseudoClassSelector(
  rawName: string,
  value: readonly ComponentValue[] | null,
  _context: SelectorParserContext = null,
): PseudoClassSelector | null {
  const name = canonicalPseudoClassName(rawName);

  switch (name) {
    // Logical combination pseudo-classes

    case 'is': {
      if (value === null) {
        return null;
      }

      const argument = parseForgivingSelectorListArgument(value);

      return {
        kind: SelectorKind.PseudoClassSelector,
        name,
        argument,
        specificity: argument.selectors.specificity,
        isFeatureless: PseudoFeatureless.Maybe,
      };
    }

    case 'where': {
      if (value === null) {
        return null;
      }

      const argument = parseForgivingSelectorListArgument(value);

      return {
        kind: SelectorKind.PseudoClassSelector,
        name,
        argument,
        specificity: Specificity0,
        isFeatureless: PseudoFeatureless.Maybe,
      };
    }

    case 'not': {
      if (value === null) {
        return null;
      }

      const selectors = parseComplexRealSelectorList(value);

      if (selectors === null) {
        return null;
      }

      const argument: ComplexRealSelectorListPseudoArgument = {
        kind: PseudoArgumentKind.ComplexRealSelectorList,
        selectors,
      };

      return {
        kind: SelectorKind.PseudoClassSelector,
        name,
        argument,
        specificity: argument.selectors.specificity,
        isFeatureless: PseudoFeatureless.Maybe,
      };
    }

    case 'has': {
      if (value === null) {
        return null;
      }

      const selectors = parseRelativeSelectorList(value);

      if (selectors === null) {
        return null;
      }

      const argument: RelativeSelectorListPseudoArgument = {
        kind: PseudoArgumentKind.RelativeSelectorList,
        selectors,
      };

      return {
        kind: SelectorKind.PseudoClassSelector,
        name,
        argument,
        specificity: argument.selectors.specificity,
        isFeatureless: PseudoFeatureless.Maybe,
      };
    }

    // Elemental pseudo-classes

    case 'defined': {
      return createNoArgumentPseudoClassSelector(name, value);
    }

    // Linguistic pseudo-classes

    case 'dir': {
      if (value === null) {
        return null;
      }

      const argument = parseDirectionArgument(value);

      if (argument === null) {
        return null;
      }

      return {
        kind: SelectorKind.PseudoClassSelector,
        name,
        argument,
        specificity: SpecificityB,
        isFeatureless: PseudoFeatureless.False,
      };
    }

    case 'lang': {
      if (value === null) {
        return null;
      }

      const argument = parseLanguageRangeListArgument(value);

      if (argument === null) {
        return null;
      }

      return {
        kind: SelectorKind.PseudoClassSelector,
        name,
        argument,
        specificity: SpecificityB,
        isFeatureless: PseudoFeatureless.False,
      };
    }

    // Location pseudo-classes

    case 'any-link':
    case 'link':
    case 'visited':
    case 'target': {
      return createNoArgumentPseudoClassSelector(name, value);
    }

    case 'scope': {
      return createNoArgumentPseudoClassSelector(
        name,
        value,
        SpecificityB,
        PseudoFeatureless.Maybe,
      );
    }

    // User action pseudo-classes

    case 'hover':
    case 'active':
    case 'focus':
    case 'focus-visible':
    case 'focus-within': {
      return createNoArgumentPseudoClassSelector(name, value);
    }

    // Resource state pseudo-classes

    case 'playing':
    case 'paused':
    case 'seeking':
    case 'buffering':
    case 'stalled':
    case 'muted':
    case 'volume-locked': {
      return createNoArgumentPseudoClassSelector(name, value);
    }

    // Element display state pseudo-classes

    case 'open':
    case 'popover-open':
    case 'modal':
    case 'fullscreen':
    case 'picture-in-picture': {
      return createNoArgumentPseudoClassSelector(name, value);
    }

    // Input pseudo-classes

    case 'enabled':
    case 'disabled':
    case 'read-only':
    case 'read-write':
    case 'placeholder-shown':
    case 'autofill':
    case 'default':
    case 'checked':
    case 'unchecked':
    case 'indeterminate':
    case 'valid':
    case 'invalid':
    case 'in-range':
    case 'out-of-range':
    case 'required':
    case 'optional':
    case 'user-valid':
    case 'user-invalid': {
      return createNoArgumentPseudoClassSelector(name, value);
    }

    // Tree-structural pseudo-classes

    case 'root':
    case 'empty': {
      return createNoArgumentPseudoClassSelector(name, value);
    }

    // Child-indexed pseudo-classes

    case 'nth-child': {
      if (value === null) {
        return null;
      }

      const argument = parseNthChildArgument(value);

      if (argument === null) {
        return null;
      }

      return {
        kind: SelectorKind.PseudoClassSelector,
        name,
        argument,
        specificity: addSpecificity(
          SpecificityB,
          argument.of?.specificity ?? Specificity0,
        ),
        isFeatureless: PseudoFeatureless.False,
      };
    }

    case 'nth-last-child': {
      if (value === null) {
        return null;
      }

      const argument = parseNthChildArgument(value);

      if (argument === null) {
        return null;
      }

      return {
        kind: SelectorKind.PseudoClassSelector,
        name,
        argument,
        specificity: addSpecificity(
          SpecificityB,
          argument.of?.specificity ?? Specificity0,
        ),
        isFeatureless: PseudoFeatureless.False,
      };
    }

    case 'first-child':
    case 'last-child':
    case 'only-child': {
      return createNoArgumentPseudoClassSelector(name, value);
    }

    // Typed child-indexed pseudo-classes

    case 'nth-of-type': {
      if (value === null) {
        return null;
      }

      const argument = parseAnPlusBArgument(value);

      if (argument === null) {
        return null;
      }

      return {
        kind: SelectorKind.PseudoClassSelector,
        name,
        argument,
        specificity: SpecificityB,
        isFeatureless: PseudoFeatureless.False,
      };
    }

    case 'nth-last-of-type': {
      if (value === null) {
        return null;
      }

      const argument = parseAnPlusBArgument(value);

      if (argument === null) {
        return null;
      }

      return {
        kind: SelectorKind.PseudoClassSelector,
        name,
        argument,
        specificity: SpecificityB,
        isFeatureless: PseudoFeatureless.False,
      };
    }

    case 'first-of-type':
    case 'last-of-type':
    case 'only-of-type': {
      return createNoArgumentPseudoClassSelector(name, value);
    }

    // Shadow pseudo-classes

    case 'host': {
      if (value === null) {
        return {
          kind: SelectorKind.PseudoClassSelector,
          name,
          argument: null,
          specificity: SpecificityB,
          isFeatureless: PseudoFeatureless.True,
        };
      }

      const selector = parseCompoundSelector(value);

      if (selector === null) {
        return null;
      }

      const argument: CompoundSelectorPseudoArgument = {
        kind: PseudoArgumentKind.CompoundSelector,
        selector,
      };

      return {
        kind: SelectorKind.PseudoClassSelector,
        name,
        argument,
        specificity: addSpecificity(
          SpecificityB,
          argument.selector.specificity,
        ),
        isFeatureless: PseudoFeatureless.True,
      };
    }

    case 'host-context': {
      if (value === null) {
        return null;
      }

      const selector = parseCompoundSelector(value);

      if (selector === null) {
        return null;
      }

      const argument: CompoundSelectorPseudoArgument = {
        kind: PseudoArgumentKind.CompoundSelector,
        selector,
      };

      return {
        kind: SelectorKind.PseudoClassSelector,
        name,
        argument,
        specificity: addSpecificity(
          SpecificityB,
          argument.selector.specificity,
        ),
        isFeatureless: PseudoFeatureless.True,
      };
    }

    case 'has-slotted': {
      return createNoArgumentPseudoClassSelector(name, value);
    }

    default:
      return null;
  }
}

function createNoArgumentPseudoClassSelector(
  name: string,
  value: readonly ComponentValue[] | null,
  specificity: Specificity = SpecificityB,
  isFeatureless: PseudoFeatureless = PseudoFeatureless.False,
): PseudoClassSelector | null {
  if (value !== null) {
    return null;
  }

  return {
    kind: SelectorKind.PseudoClassSelector,
    name,
    argument: null,
    specificity,
    isFeatureless,
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

function parseForgivingSelectorListArgument(
  arg: readonly ComponentValue[],
): ForgivingSelectorListPseudoArgument {
  const arms = parseListAsComponentGrammar(
    arg,
    withComponentTrivia(tryConsumeComplexRealSelector),
  ).filter((selector): selector is ComplexRealSelector => selector !== null);

  return {
    kind: PseudoArgumentKind.ForgivingSelectorList,
    selectors: {
      kind: SelectorKind.ComplexRealSelectorList,
      arms,
      specificity: listSpecificity(arms),
    },
  };
}

function parseAnPlusBArgument(
  value: readonly ComponentValue[],
): AnPlusBPseudoArgument | null {
  const anb = parseAsComponentGrammar(
    value,
    withComponentTrivia(tryConsumeAnPlusB),
  );

  if (anb === null) {
    return null;
  }

  return {
    kind: PseudoArgumentKind.AnPlusB,
    ...anb,
  };
}

function tryConsumeAnPlusB(_c: ComponentCursor): { a: number; b: number; } | null {
  return null; // TODO: Implement An+B parser
}

function parseNthChildArgument(
  value: readonly ComponentValue[],
): NthChildPseudoArgument | null {
  return parseAsComponentGrammar(
    value,
    tryConsumeNthChildArgument,
  );
}

function tryConsumeNthChildArgument(c: ComponentCursor): NthChildPseudoArgument | null {
  const start = c.pos();

  const anb = withComponentTrivia(tryConsumeAnPlusB)(c);

  if (anb === null) {
    c.restore(start);
    return null;
  }

  const of = tryConsumeNthChildOfClause(c);

  return {
    kind: PseudoArgumentKind.NthChild,
    ...anb,
    of,
  };
}

const tryConsumeOfIdent = createIdentValueConsumer('of');

function tryConsumeNthChildOfClause(c: ComponentCursor): ComplexRealSelectorList | null {
  const start = c.pos();

  if (withComponentTrivia(tryConsumeOfIdent)(c) === null) {
    c.restore(start);
    return null;
  }

  const selectors = withComponentTrivia(tryConsumeComplexRealSelectorList)(c);

  if (selectors === null) {
    c.restore(start);
    return null;
  }

  return selectors;
}

function parseLanguageRangeListArgument(
  value: readonly ComponentValue[],
): LanguageRangeListPseudoArgument | null {
  const parsed = parseListAsComponentGrammar(
    value,
    withComponentTrivia(tryConsumeLanguageRange),
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
    kind: PseudoArgumentKind.LanguageRangeList,
    ranges,
  };
}

function tryConsumeLanguageRange(c: ComponentCursor): LanguageRange | null {
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

function parseDirectionArgument(
  value: readonly ComponentValue[],
): DirectionPseudoArgument | null {
  const raw = parseAsComponentGrammar(
    value,
    withComponentTrivia(tryConsumeDirectionIdent),
  );

  if (raw === null) {
    return null; // invalid syntax: not a single ident, trailing junk, etc.
  }

  return {
    kind: PseudoArgumentKind.Direction,
    value: raw === 'ltr' || raw === 'rtl' ? raw : null,
  };
}

function tryConsumeDirectionIdent(c: ComponentCursor): string | null {
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
  value: readonly ComponentValue[] | null,
  legacy: boolean,
  _context: SelectorParserContext = null,
): PseudoElementSelector | null {
  const name = asciiLower(rawName);

  switch (name) {
    // Typographic pseudo-elements

    case 'first-line':
    case 'first-letter': {
      return createNoArgumentPseudoElementSelector(name, value, legacy);
    }

    // Sub-pseudo-elements of ::first-letter.
    // Valid in chains like ::first-letter::prefix / ::first-letter::suffix.
    // Placement validity is not handled here yet.

    case 'prefix':
    case 'suffix': {
      return createNoArgumentPseudoElementSelector(name, value, legacy);
    }

    // Highlight pseudo-elements

    case 'selection':
    case 'search-text':
    case 'target-text':
    case 'spelling-error':
    case 'grammar-error': {
      return createNoArgumentPseudoElementSelector(name, value, legacy);
    }

    case 'highlight': {
      if (legacy || value === null) {
        return null;
      }

      const ident = parseCustomIdent(value);

      if (ident === null) {
        return null;
      }

      const argument: CustomIdentPseudoArgument = {
        kind: PseudoArgumentKind.CustomIdent,
        value: ident,
      };

      return {
        kind: SelectorKind.PseudoElementSelector,
        name,
        argument,
        specificity: SpecificityC,
        isFeatureless: PseudoFeatureless.True,
      };
    }

    // Generated content pseudo-elements

    case 'before':
    case 'after': {
      return createNoArgumentPseudoElementSelector(name, value, legacy);
    }

    // List marker pseudo-elements

    case 'marker': {
      return createNoArgumentPseudoElementSelector(name, value, legacy);
    }

    // Input pseudo-elements

    case 'placeholder': {
      return createNoArgumentPseudoElementSelector(name, value, legacy);
    }

    // Element-backed pseudo-elements

    case 'file-selector-button':
    case 'details-content': {
      return createNoArgumentPseudoElementSelector(name, value, legacy);
    }

    // Shadow pseudo-elements

    case 'slotted': {
      if (legacy || value === null) {
        return null;
      }

      const selector = parseCompoundSelector(value);

      if (selector === null) {
        return null;
      }

      const argument: CompoundSelectorPseudoArgument = {
        kind: PseudoArgumentKind.CompoundSelector,
        selector,
      };

      return {
        kind: SelectorKind.PseudoElementSelector,
        name,
        argument,
        specificity: addSpecificity(
          SpecificityC,
          argument.selector.specificity,
        ),
        isFeatureless: PseudoFeatureless.True,
      };
    }

    case 'part': {
      if (legacy || value === null) {
        return null;
      }

      const argument = parsePartNameListArgument(value);

      if (argument === null) {
        return null;
      }

      return {
        kind: SelectorKind.PseudoElementSelector,
        name,
        argument,
        specificity: SpecificityC,
        isFeatureless: PseudoFeatureless.True,
      };
    }

    default: {
      return null;
    }
  }
}

function createNoArgumentPseudoElementSelector(
  name: string,
  value: readonly ComponentValue[] | null,
  legacy: boolean,
  specificity: Specificity = SpecificityC,
): PseudoElementSelector | null {
  if (value !== null) {
    return null;
  }

  // Defensive only. The parser already restricts legacy names before this.
  if (legacy && !isLegacyPseudoElementName(name)) {
    return null;
  }

  return {
    kind: SelectorKind.PseudoElementSelector,
    name,
    argument: null,
    specificity,
    isFeatureless: PseudoFeatureless.True,
  };
}

function tryConsumePartNameList(c: ComponentCursor): string[] | null {
  return consumePartNameList(c);
}

const consumePartNameList: TryComponentParser<string[]> = plus(
  withComponentTrivia((c): string | null => {
    const ident = tryConsumeIdentToken(c);
    return ident?.value ?? null;
  }),
);

function parsePartNameListArgument(
  value: readonly ComponentValue[],
): PartNameListPseudoArgument | null {
  const names = parseAsComponentGrammar(value, tryConsumePartNameList);

  if (names === null) {
    return null;
  }

  return {
    kind: PseudoArgumentKind.PartNameList,
    names,
  };
}

export enum PseudoArgumentKind {
  ForgivingSelectorList = 'forgiving-selector-list',
  ComplexRealSelectorList = 'complex-real-selector-list',
  RelativeSelectorList = 'relative-selector-list',
  CompoundSelector = 'compound-selector',
  Direction = 'direction',
  LanguageRangeList = 'language-range-list',
  AnPlusB = 'an-plus-b',
  NthChild = 'nth-child',
  PartNameList = 'part-name-list',
  CustomIdent = 'custom-ident',
}

type PseudoClassArgument =
  | ForgivingSelectorListPseudoArgument
  | ComplexRealSelectorListPseudoArgument
  | RelativeSelectorListPseudoArgument
  | CompoundSelectorPseudoArgument
  | DirectionPseudoArgument
  | LanguageRangeListPseudoArgument
  | AnPlusBPseudoArgument
  | NthChildPseudoArgument;

type PseudoElementArgument =
  | CompoundSelectorPseudoArgument
  | PartNameListPseudoArgument
  | CustomIdentPseudoArgument;

type ForgivingSelectorListPseudoArgument = {
  kind: PseudoArgumentKind.ForgivingSelectorList;
  selectors: ComplexRealSelectorList;
};

type RelativeSelectorListPseudoArgument = {
  kind: PseudoArgumentKind.RelativeSelectorList;
  selectors: RelativeSelectorList;
};

type ComplexRealSelectorListPseudoArgument = {
  kind: PseudoArgumentKind.ComplexRealSelectorList;
  selectors: ComplexRealSelectorList;
};

type CompoundSelectorPseudoArgument = {
  kind: PseudoArgumentKind.CompoundSelector;
  selector: CompoundSelector;
};

type DirectionPseudoArgument = {
  kind: PseudoArgumentKind.Direction;
  value: 'ltr' | 'rtl' | null;
};

type LanguageRangeListPseudoArgument = {
  kind: PseudoArgumentKind.LanguageRangeList;
  ranges: LanguageRange[];
};

type LanguageRange = string;

type AnPlusBPseudoArgument = {
  kind: PseudoArgumentKind.AnPlusB;
  a: number;
  b: number;
};

type NthChildPseudoArgument = {
  kind: PseudoArgumentKind.NthChild;
  a: number;
  b: number;
  of: ComplexRealSelectorList | null;
};

type PartNameListPseudoArgument = {
  kind: PseudoArgumentKind.PartNameList;
  names: string[];
};

type CustomIdentPseudoArgument = {
  kind: PseudoArgumentKind.CustomIdent;
  value: CustomIdentValue;
};
