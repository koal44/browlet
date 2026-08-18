import { asciiLower } from '../../shared/css';
import { assertNever } from '../../shared/util';
import {
  any, commaRepeat, one, oneOf, opt, plus, adaptConsumer, requiredSequenceOf, sequenceOf, withTrivia,
} from './component-grammar';
import { type TokenCursor, type TryConsumer, type TryConsumerResult } from './token-cursor';
import {
  consumeAmpersandDelim, consumeAnyValueFunctionBlock,
  consumeAsteriskDelim, consumeBracketBlock,
  consumeCaretDelim, consumeColon, consumeDollarDelim, consumeDotDelim,
  consumeEqualsDelim, consumeGreaterDelim, consumeIdentToken, consumeIdHashToken,
  consumeIntegerToken, consumePipeDelim, consumePlusDelim, consumeStringToken,
  consumeTildeDelim,
} from './component-consumers';
import {
  isComponentBlock, isDelimToken, isWhitespaceToken,
  serializeComponentValues, serializeCssIdentifier, serializeCssString,
  type ComponentValue,
} from './component-value';
import {
  parseAsComponentGrammar, parseCommaSeparatedListOfComponentValues,
  parseListAsComponentGrammar,
  type ParserInput,
} from './parser';
import { TokenKind } from './tokens';
import { parseCustomIdent, serializeCustomIdent, type CustomIdentValue } from '../values/custom-ident';
import { consumeAnPlusB, serializeAnPlusB, type AnPlusBValue } from '../values/an-plus-b';
import { createKeywordConsumer } from '../values/keyword';
import { serializeCssInteger } from '../values/numeric-literal/integer';

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
  UnparsedSelector = 'unparsed-selector',
  RelativeSelector = 'relative-selector',
  RelativeRealSelector = 'relative-real-selector',
  CompoundSelector = 'compound-selector',
  PseudoCompoundSelector = 'pseudo-compound-selector',
  NestingSelector = 'nesting-selector',
  TypeSelector = 'type-selector',
  IdSelector = 'id-selector',
  ClassSelector = 'class-selector',
  AttributeSelector = 'attribute-selector',
  PseudoClassSelector = 'pseudo-class-selector',
  PseudoElementSelector = 'pseudo-element-selector',
  LegacyPseudoElementSelector = 'legacy-pseudo-element-selector',
}

export type SelectorParserContext = Readonly<{
  // Pseudo-element governing pseudo-class validity in this tail.
  pseudoClassTailElement?: PseudoElementName;

  // Origin against which the next sub-pseudo-element candidate is validated.
  subPseudoElementOrigin?: PseudoElementName;

  // Pseudo-element on the left side of the next potential combinator.
  combinatorLeftPseudoElement?: PseudoElementName;

  // Namespace name associated with each declared prefix.
  namespacePrefixes?: ReadonlyMap<string, string>;

  // Namespace name applied to unprefixed type selectors, when declared.
  defaultNamespace?: string;

  // Strongest selector grammar allowed by the enclosing selector argument.
  selectorRestriction?: SelectorRestriction;

  // Parent selector expansion represented by `&`.
  nestingSelectorExpansion?: PseudoClassSelector;

  // Whether this selector is nested anywhere inside a :has() argument.
  insideHas?: boolean;
}>;

export type SelectorRestriction = 'complex-real' | 'compound' | 'simple';

function contextForSelectorArgument(
  context: SelectorParserContext,
  restriction?: SelectorRestriction,
): SelectorParserContext {
  const pseudoElement = context.pseudoClassTailElement;

  return {
    namespacePrefixes: context.namespacePrefixes,
    defaultNamespace: context.defaultNamespace,
    selectorRestriction: narrowSelectorRestriction(
      context.selectorRestriction,
      restriction,
    ),
    nestingSelectorExpansion: context.nestingSelectorExpansion,
    insideHas: context.insideHas,
    pseudoClassTailElement:
      pseudoElement !== undefined && !isElementBackedPseudoElement(pseudoElement)
        ? pseudoElement
        : undefined,
  };
}

function narrowSelectorRestriction(
  a?: SelectorRestriction,
  b?: SelectorRestriction,
): SelectorRestriction {
  if (a === 'simple' || b === 'simple') return 'simple';
  if (a === 'compound' || b === 'compound') return 'compound';
  return 'complex-real';
}

/*
 * 17.1. Parse a selector
 *
 * Spec hook. Despite the singular name, this parses as <selector-list>
 * and returns a complex selector list.
 */
export function parseSelector(
  input: ParserInput,
  context: SelectorParserContext = {},
): SelectorList | null {
  return parseSelectorList(input, context);
}

/*
 * 17.2. Parse a relative selector
 *
 * Spec hook. Despite the singular name, this parses as <relative-selector-list>.
 */
export function parseRelativeSelector(
  input: ParserInput,
  context: SelectorParserContext = {},
): RelativeSelectorList | null {
  return parseRelativeSelectorList(input, context);
}

/*
 * CSS Nesting 1, "Nesting Style Rules"
 *
 * Nested style-rule preludes accept <relative-selector-list>. The resulting
 * selectors are absolutized by inserting an implied `&` where required.
 */
export function parseNestedSelectorList(
  input: ParserInput,
  parentSelectors: SelectorList,
  context: SelectorParserContext = {},
): SelectorList | null {
  const expansion = createNestingSelectorExpansion(parentSelectors);
  const relative = parseRelativeSelectorList(input, {
    ...context,
    nestingSelectorExpansion: expansion,
  });

  if (relative === null) return null;

  const inputArms = parseCommaSeparatedListOfComponentValues(input);
  const arms = relative.arms.map((arm, index): ComplexSelector => {
    const containsNesting = containsAmpersand(inputArms[index] ?? []);

    if (arm.combinator === null && containsNesting) {
      return arm.selector;
    }

    const nesting: NestingSelector = {
      kind: SelectorKind.NestingSelector,
      expanded: expansion,
      specificity: expansion.specificity,
    };
    const compound: CompoundSelector = {
      kind: SelectorKind.CompoundSelector,
      typeSelector: null,
      subclasses: [nesting],
      specificity: nesting.specificity,
    };
    const unit: ComplexSelectorUnit = {
      kind: SelectorKind.ComplexSelectorUnit,
      compound,
      pseudoCompounds: [],
      specificity: compound.specificity,
    };
    const combinator = arm.combinator ?? ' ';

    return {
      kind: SelectorKind.ComplexSelector,
      parts: [
        { combinator: null, unit },
        ...arm.selector.parts.map((part, partIndex) => partIndex === 0
          ? { ...part, combinator }
          : part),
      ],
      specificity: addSpecificity(
        nesting.specificity,
        arm.selector.specificity,
      ),
    };
  });

  return {
    kind: SelectorKind.ComplexSelectorList,
    arms,
    specificity: listSpecificity(arms),
  };
}

/*
 * <selector-list> = <complex-selector-list>
 */
export type SelectorList = ComplexSelectorList;

export function parseSelectorList(
  input: ParserInput,
  context: SelectorParserContext = {},
): SelectorList | null {
  return parseAsComponentGrammar(input, consumeSelectorList, context);
}

function consumeSelectorList(c: TokenCursor): TryConsumerResult<SelectorList> {
  return consumeComplexSelectorList(c);
}

/*
 * <complex-selector-list> = <complex-selector>#
 */
export type ComplexSelectorList = {
  kind: SelectorKind.ComplexSelectorList;
  arms: ComplexSelector[];
  specificity: Specificity;
};

export function parseComplexSelectorList(
  input: ParserInput,
  context: SelectorParserContext = {},
): ComplexSelectorList | null {
  return parseAsComponentGrammar(input, consumeComplexSelectorList, context);
}

function consumeComplexSelectorList(c: TokenCursor): TryConsumerResult<ComplexSelectorList> {
  return complexSelectorListConsumer(c);
}

// <complex-selector-list> = <complex-selector>#
const complexSelectorListConsumer: TryConsumer<ComplexSelectorList> = adaptConsumer(
  commaRepeat(consumeComplexSelector),
  (arms) => ({
    kind: SelectorKind.ComplexSelectorList,
    arms,
    specificity: listSpecificity(arms),
  }),
);

/*
 * <complex-real-selector-list> = <complex-real-selector>#
 */
export type ComplexRealSelectorList = {
  kind: SelectorKind.ComplexRealSelectorList;
  arms: ComplexRealSelector[];
  specificity: Specificity;
};

export function parseComplexRealSelectorList(
  input: ParserInput,
  context: SelectorParserContext = {},
): ComplexRealSelectorList | null {
  return parseAsComponentGrammar(input, consumeComplexRealSelectorList, context);
}

function consumeComplexRealSelectorList(c: TokenCursor): TryConsumerResult<ComplexRealSelectorList> {
  return complexRealSelectorListConsumer(c);
}

// <complex-real-selector-list> = <complex-real-selector>#
const complexRealSelectorListConsumer: TryConsumer<ComplexRealSelectorList> = adaptConsumer(
  commaRepeat(consumeComplexRealSelector),
  (arms) => ({
    kind: SelectorKind.ComplexRealSelectorList,
    arms,
    specificity: listSpecificity(arms),
  }),
);

/*
 * <compound-selector-list> = <compound-selector>#
 */
export type CompoundSelectorList = {
  kind: SelectorKind.CompoundSelectorList;
  arms: CompoundSelector[];
  specificity: Specificity;
};

export function parseCompoundSelectorList(
  input: ParserInput,
  context: SelectorParserContext = {},
): CompoundSelectorList | null {
  return parseAsComponentGrammar(input, consumeCompoundSelectorList, context);
}

function consumeCompoundSelectorList(c: TokenCursor): TryConsumerResult<CompoundSelectorList> {
  return compoundSelectorListConsumer(c);
}

// <compound-selector-list> = <compound-selector>#
const compoundSelectorListConsumer: TryConsumer<CompoundSelectorList> = adaptConsumer(
  commaRepeat(consumeCompoundSelector),
  (arms) => ({
    kind: SelectorKind.CompoundSelectorList,
    arms,
    specificity: listSpecificity(arms),
  }),
);

/*
 * <simple-selector-list> = <simple-selector>#
 */
export type SimpleSelectorList = {
  kind: SelectorKind.SimpleSelectorList;
  arms: SimpleSelector[];
  specificity: Specificity;
};

export function parseSimpleSelectorList(
  input: ParserInput,
  context: SelectorParserContext = {},
): SimpleSelectorList | null {
  return parseAsComponentGrammar(input, consumeSimpleSelectorList, context);
}

function consumeSimpleSelectorList(c: TokenCursor): TryConsumerResult<SimpleSelectorList> {
  return simpleSelectorListConsumer(c);
}

// <simple-selector-list> = <simple-selector>#
const simpleSelectorListConsumer: TryConsumer<SimpleSelectorList> = adaptConsumer(
  commaRepeat(consumeSimpleSelector),
  (arms) => ({
    kind: SelectorKind.SimpleSelectorList,
    arms,
    specificity: listSpecificity(arms),
  }),
);

/*
 * <relative-selector-list> = <relative-selector>#
 */
export type RelativeSelectorList = {
  kind: SelectorKind.RelativeSelectorList;
  arms: RelativeSelector[];
  specificity: Specificity;
};

export function parseRelativeSelectorList(
  input: ParserInput,
  context: SelectorParserContext = {},
): RelativeSelectorList | null {
  return parseAsComponentGrammar(input, consumeRelativeSelectorList, context);
}

function consumeRelativeSelectorList(c: TokenCursor): TryConsumerResult<RelativeSelectorList> {
  return relativeSelectorListConsumer(c);
}

// <relative-selector-list> = <relative-selector>#
const relativeSelectorListConsumer: TryConsumer<RelativeSelectorList> = adaptConsumer(
  commaRepeat(consumeRelativeSelector),
  (arms) => ({
    kind: SelectorKind.RelativeSelectorList,
    arms,
    specificity: listSpecificity(arms),
  }),
);

/*
 * <relative-real-selector-list> = <relative-real-selector>#
 */
export type RelativeRealSelectorList = {
  kind: SelectorKind.RelativeRealSelectorList;
  arms: RelativeRealSelector[];
  specificity: Specificity;
};

export function parseRelativeRealSelectorList(
  input: ParserInput,
  context: SelectorParserContext = {},
): RelativeRealSelectorList | null {
  return parseAsComponentGrammar(input, consumeRelativeRealSelectorList, context);
}

function consumeRelativeRealSelectorList(c: TokenCursor): TryConsumerResult<RelativeRealSelectorList> {
  return relativeRealSelectorListConsumer(c);
}

// <relative-real-selector-list> = <relative-real-selector>#
const relativeRealSelectorListConsumer: TryConsumer<RelativeRealSelectorList> = adaptConsumer(
  commaRepeat(consumeRelativeRealSelector),
  (arms) => ({
    kind: SelectorKind.RelativeRealSelectorList,
    arms,
    specificity: listSpecificity(arms),
  }),
);

/*
 * <complex-selector> =
 *   <complex-selector-unit> [ <combinator>? <complex-selector-unit> ]*
 *
 * The parser-level combinator represents omitted descendant combinators as
 * whitespace, so execution uses the equivalent normalized tail:
 *
 *   <complex-selector-unit> [ <parser-combinator> <complex-selector-unit> ]*
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
  input: ParserInput,
  context: SelectorParserContext = {},
): ComplexSelector | null {
  return parseAsComponentGrammar(input, consumeComplexSelector, context);
}

function consumeComplexSelector(c: TokenCursor): TryConsumerResult<ComplexSelector> {
  return complexSelectorConsumer(c);
}

const complexSelectorConsumer: TryConsumer<ComplexSelector> = sequenceOf(
  [
    one(consumeComplexSelectorUnit, {
      contextAfter: (unit, context) =>
        contextAfterComplexSelectorUnit(context as SelectorParserContext, unit),
    }),

    any(
      sequenceOf(
        [
          one(consumeCombinator),
          one(consumeComplexSelectorUnit),
        ],

        ([[combinator], [unit]]) => ({
          combinator,
          unit,
        }),
      ),
      {
        contextAfter: (tailPart, context) =>
          contextAfterComplexSelectorUnit(context as SelectorParserContext, tailPart.unit),
      },
    ),
  ],

  ([[head], tail]) => ({
    kind: SelectorKind.ComplexSelector,
    parts: [{ combinator: null, unit: head }, ...tail],
    specificity: sumSpecificity([
      head.specificity,
      ...tail.map((part) => part.unit.specificity),
    ]),
  }),
);

function contextAfterComplexSelectorUnit(
  context: SelectorParserContext,
  unit: ComplexSelectorUnit,
): SelectorParserContext {
  const pseudoCompound = unit.pseudoCompounds[unit.pseudoCompounds.length - 1];
  const pseudoElName = canonicalPseudoElementName(pseudoCompound?.pseudoElement.name);
  return {
    ...context,
    combinatorLeftPseudoElement: pseudoElName ?? undefined,
  };
}

/*
 * <complex-selector-unit> =
 *   [ <compound-selector>? <pseudo-compound-selector>* ]!
 */
export type ComplexSelectorUnit = {
  kind: SelectorKind.ComplexSelectorUnit;
  compound: CompoundSelector | null;
  pseudoCompounds: PseudoCompoundSelector[];
  specificity: Specificity;
};

function consumeComplexSelectorUnit(c: TokenCursor): TryConsumerResult<ComplexSelectorUnit> {
  return complexSelectorUnitConsumer(c);
}

const complexSelectorUnitConsumer: TryConsumer<ComplexSelectorUnit> =
  requiredSequenceOf(
    [
      opt(consumeCompoundSelector),

      any(consumePseudoCompoundSelector, {
        contextAfter: (pseudoCompound, context) => {
          const pseudoElName = canonicalPseudoElementName(pseudoCompound.pseudoElement.name);
          const newContext: SelectorParserContext = {
            ...(context as SelectorParserContext),
            subPseudoElementOrigin: pseudoElName ?? undefined,
          };
          return newContext;
        },
      }),
    ],

    ([[compound], pseudoCompounds]) => ({
      kind: SelectorKind.ComplexSelectorUnit,
      compound: compound ?? null,
      pseudoCompounds,
      specificity: sumSpecificity([
        compound?.specificity,
        ...pseudoCompounds.map((pseudo) => pseudo.specificity),
      ]),
    }),
  );

/*
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
  input: ParserInput,
  context: SelectorParserContext = {},
): ComplexRealSelector | null {
  return parseAsComponentGrammar(input, consumeComplexRealSelector, context);
}

function consumeComplexRealSelector(c: TokenCursor): TryConsumerResult<ComplexRealSelector> {
  return complexRealSelectorConsumer(c);
}

const complexRealSelectorConsumer: TryConsumer<ComplexRealSelector> = sequenceOf(
  [
    one(consumeCompoundSelector),

    any(
      sequenceOf(
        [
          one(consumeCombinator),
          one(consumeCompoundSelector),
        ],

        ([[combinator], [compound]]) => ({
          combinator,
          compound,
        }),
      ),
    ),
  ],

  ([[head], tail]) => ({
    kind: SelectorKind.ComplexRealSelector,
    parts: [{ combinator: null, compound: head }, ...tail],
    specificity: sumSpecificity([
      head.specificity,
      ...tail.map((part) => part.compound.specificity),
    ]),
  }),
);

/*
 * <relative-selector> = <combinator>? <complex-selector>
 */
export type RelativeSelector = {
  kind: SelectorKind.RelativeSelector;
  combinator: Combinator | null;
  selector: ComplexSelector;
  specificity: Specificity;
};

function consumeRelativeSelector(c: TokenCursor): TryConsumerResult<RelativeSelector> {
  return relativeSelectorConsumer(c);
}

const relativeSelectorConsumer: TryConsumer<RelativeSelector> = sequenceOf(
  [
    opt(consumeCombinator),
    one(consumeComplexSelector),
  ],

  ([combinator, [selector]]) => ({
    kind: SelectorKind.RelativeSelector,
    combinator: combinator[0] ?? null,
    selector,
    specificity: selector.specificity,
  }),
);

/*
 * <relative-real-selector> = <combinator>? <complex-real-selector>
 */
export type RelativeRealSelector = {
  kind: SelectorKind.RelativeRealSelector;
  combinator: Combinator | null;
  selector: ComplexRealSelector;
  specificity: Specificity;
};

function consumeRelativeRealSelector(c: TokenCursor): TryConsumerResult<RelativeRealSelector> {
  return relativeRealSelectorConsumer(c);
}

const relativeRealSelectorConsumer: TryConsumer<RelativeRealSelector> = sequenceOf(
  [
    opt(consumeCombinator),
    one(consumeComplexRealSelector),
  ],

  ([combinator, [selector]]) => ({
    kind: SelectorKind.RelativeRealSelector,
    combinator: combinator[0] ?? null,
    selector,
    specificity: selector.specificity,
  }),
);

/*
 * <compound-selector> = [ <type-selector>? <subclass-selector>* ]!
 */
export type CompoundSelector = {
  kind: SelectorKind.CompoundSelector;
  typeSelector: TypeSelector | null;
  subclasses: SubclassSelector[];
  specificity: Specificity;
};

export function parseCompoundSelector(
  input: ParserInput,
  context: SelectorParserContext = {},
): CompoundSelector | null {
  return parseAsComponentGrammar(input, consumeCompoundSelector, context);
}

function consumeCompoundSelector(c: TokenCursor): TryConsumerResult<CompoundSelector> {
  return compoundSelectorConsumer(c);
}

const compoundSelectorConsumer: TryConsumer<CompoundSelector> = requiredSequenceOf(
  [
    opt(consumeTypeSelector),
    any(consumeSubclassSelector),
  ],

  ([[typeSelector], subclasses]) => ({
    kind: SelectorKind.CompoundSelector,
    typeSelector: typeSelector ?? null,
    subclasses,
    specificity: sumSpecificity([
      typeSelector?.specificity,
      ...subclasses.map((subclass) => subclass.specificity),
    ]),
  }),
);

/*
 * <pseudo-compound-selector> =
 *   <pseudo-element-selector> <pseudo-class-selector>*
 */
export type PseudoCompoundSelector = {
  kind: SelectorKind.PseudoCompoundSelector;
  pseudoElement: PseudoElementSelector;
  pseudoClasses: PseudoClassSelector[];
  specificity: Specificity;
};

function consumePseudoCompoundSelector(
  c: TokenCursor,
): TryConsumerResult<PseudoCompoundSelector> {
  return pseudoCompoundSelectorConsumer(c);
}

const pseudoCompoundSelectorConsumer: TryConsumer<PseudoCompoundSelector> = sequenceOf(
  [
    one(consumePseudoElementSelector, {
      contextAfter: (pseudoElement, context) => {
        const pseudoElName = canonicalPseudoElementName(pseudoElement.name);
        const selectorContext = context as SelectorParserContext;
        const newContext: SelectorParserContext = {
          ...selectorContext,
          pseudoClassTailElement: pseudoElName ?? undefined,
          selectorRestriction:
            pseudoElName !== null && !isElementBackedPseudoElement(pseudoElName)
              ? narrowSelectorRestriction(
                selectorContext.selectorRestriction,
                'compound',
              )
              : selectorContext.selectorRestriction,
        };
        return newContext;
      },
    }),
    any(consumePseudoClassSelector),
  ],

  ([[pseudoElement], pseudoClasses], context) => {
    const name = canonicalPseudoElementName(pseudoElement.name);
    const selectorContext = context as SelectorParserContext;

    if (
      name === null ||
      !isValidSubPseudoElement(selectorContext.subPseudoElementOrigin, name)
    ) {
      return null;
    }

    return {
      kind: SelectorKind.PseudoCompoundSelector,
      pseudoElement,
      pseudoClasses,
      specificity: sumSpecificity([
        pseudoElement.specificity,
        ...pseudoClasses.map((pseudo) => pseudo.specificity),
      ]),
    };
  },
);

/*
 * <simple-selector> = <type-selector> | <subclass-selector>
 */
export type SimpleSelector = TypeSelector | SubclassSelector;

export function parseSimpleSelector(
  input: ParserInput,
  context: SelectorParserContext = {},
): SimpleSelector | null {
  return parseAsComponentGrammar(input, consumeSimpleSelector, context);
}

function consumeSimpleSelector(c: TokenCursor): TryConsumerResult<SimpleSelector> {
  return simpleSelectorConsumer(c);
}

const simpleSelectorConsumer: TryConsumer<SimpleSelector> = oneOf(
  [
    one(consumeTypeSelector),
    one(consumeSubclassSelector),
  ],

  ([selector]) => selector,
);

/*
 * Parser-level selector combinator.
 *
 * The spec's <combinator> production is only:
 *   '>' | '+' | '~' | '||'
 *
 * We also include ' ' for the omitted-combinator descendant case between
 * complex selector units.
 */
export type Combinator = ' ' | '>' | '+' | '~' | '||';

function consumeCombinator(c: TokenCursor): TryConsumerResult<Combinator> {
  return combinatorConsumer(c);
}

const combinatorConsumer: TryConsumer<Combinator> = oneOf(
  [
    one(consumeDescendantCombinator),

    // <whitespace-token>* [ '>' | '+' | '~' | '||' ] <whitespace-token>*
    one(
      sequenceOf(
        [
          opt(consumeCombinatorWhitespace),

          one(
            oneOf(
              [
                one(consumeGreaterDelim),
                one(consumePlusDelim),
                one(consumeTildeDelim),

                one(
                  sequenceOf(
                    [
                      one(consumePipeDelim),
                      one(consumePipeDelim),
                    ],
                    () => '||' as const,
                  ),
                ),
              ],
              ([combinator]) => combinator,
            ),
          ),

          opt(consumeCombinatorWhitespace),
        ],
        (value) => value[1][0],
      ),
    ),
  ],

  ([combinator], context) => {
    const pseudoElement = (context as SelectorParserContext)
      .combinatorLeftPseudoElement;

    return pseudoElement === undefined ||
      isValidCombinatorAfterPseudoElement(pseudoElement, combinator)
      ? combinator
      : null;
  },
);

// <whitespace-token>+ without a following explicit combinator
function consumeDescendantCombinator(
  c: TokenCursor,
): TryConsumerResult<' '> {
  const start = c.pos();

  if (consumeCombinatorWhitespace(c) === null) return null;

  const afterWhitespace = c.pos();
  const first = c.peek();

  if (
    isDelimToken(first, '>') ||
    isDelimToken(first, '+') ||
    isDelimToken(first, '~') ||
    isDelimToken(first, '|') && isDelimToken(c.peek(1), '|')
  ) {
    c.restore(start);
    return null;
  }

  c.restore(afterWhitespace);
  return ' ';
}

// <whitespace-token>+
function consumeCombinatorWhitespace(
  c: TokenCursor,
): TryConsumerResult<' '> {
  return c.consumeWhile(isWhitespaceToken) === 0 ? null : ' ';
}

/*
 * <wq-name> = <ns-prefix>? <ident-token>
 */
export type WqName = {
  namespace: string | null;
  namespaceURI?: string | null;
  localName: string;
};

function consumeWqName(c: TokenCursor): TryConsumerResult<WqName> {
  return wqNameConsumer(c);
}

const wqNameConsumer: TryConsumer<WqName> = sequenceOf(
  [
    opt(consumeNsPrefix),
    one(consumeIdentToken),
  ],

  ([namespace, [localName]], context) => ({
    ...resolveAttributeNamespace(
      namespace[0] ?? null,
      context as SelectorParserContext,
    ),
    localName: localName.value,
  }),
);

/*
 * <ns-prefix> = [ <ident-token> | '*' ]? '|'
 */
function consumeNsPrefix(c: TokenCursor): TryConsumerResult<string> {
  return nsPrefixConsumer(c);
}

const nsPrefixConsumer: TryConsumer<string> = sequenceOf(
  [
    opt(
      oneOf(
        [
          one(consumeIdentToken),
          one(consumeAsteriskDelim),
        ],
        ([prefix]) => typeof prefix === 'string'
          ? prefix
          : prefix.value,
      ),
    ),
    one(consumePipeDelim),
  ],

  ([prefix], context) => {
    const value = prefix[0] ?? '';

    if (value === '' || value === '*') return value;

    return (context as SelectorParserContext)
      .namespacePrefixes?.has(value) === true
      ? value
      : null;
  },
);

/*
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
  namespaceURI?: string | null;
  name: string;
  specificity: Specificity;
};

function consumeTypeSelector(c: TokenCursor): TryConsumerResult<TypeSelector> {
  const ctx = c.context as SelectorParserContext;

  if (ctx.pseudoClassTailElement !== undefined) {
    return null;
  }

  return typeSelectorConsumer(c);
}

const typeSelectorConsumer: TryConsumer<TypeSelector> = sequenceOf(
  [
    opt(consumeNsPrefix),

    one(
      oneOf(
        [
          one(consumeIdentToken),
          one(consumeAsteriskDelim),
        ],

        ([name]) => typeof name === 'string'
          ? name
          : name.value,
      ),
    ),
  ],

  ([namespace, [name]], context) => ({
    kind: SelectorKind.TypeSelector,
    ...resolveTypeNamespace(
      namespace[0] ?? null,
      context as SelectorParserContext,
    ),
    name,
    specificity: name === '*' ? Specificity0 : SpecificityC,
  }),
);

function resolveTypeNamespace(
  namespace: string | null,
  context: SelectorParserContext,
): Pick<TypeSelector, 'namespace' | 'namespaceURI'> {
  if (namespace === null) {
    return context.defaultNamespace === undefined
      ? { namespace: null }
      : {
        namespace: null,
        namespaceURI: normalizeNamespaceURI(context.defaultNamespace),
      };
  }

  if (namespace === '*') {
    return {
      namespace: context.defaultNamespace === undefined ? null : '*',
    };
  }

  if (namespace === '') return { namespace: '', namespaceURI: null };

  const namespaceName = context.namespacePrefixes!.get(namespace)!;
  const namespaceURI = normalizeNamespaceURI(namespaceName);
  return {
    namespace:
      namespaceName === context.defaultNamespace ? null
      : namespaceURI === null ? ''
      : namespace,
    namespaceURI,
  };
}

function resolveAttributeNamespace(
  namespace: string | null,
  context: SelectorParserContext,
): Pick<WqName, 'namespace' | 'namespaceURI'> {
  if (namespace === null || namespace === '') {
    return { namespace: null, namespaceURI: null };
  }

  if (namespace === '*') return { namespace: '*' };

  const namespaceURI = normalizeNamespaceURI(
    context.namespacePrefixes!.get(namespace)!,
  );
  return namespaceURI === null
    ? { namespace: null, namespaceURI }
    : { namespace, namespaceURI };
}

function normalizeNamespaceURI(namespace: string): string | null {
  return namespace === '' ? null : namespace;
}

/*
 * CSS Nesting 1, "Nesting Selector: the '&' selector"
 */
export type NestingSelector = {
  kind: SelectorKind.NestingSelector;
  expanded: PseudoClassSelector | null;
  specificity: Specificity;
};

function consumeNestingSelector(c: TokenCursor): TryConsumerResult<NestingSelector> {
  const context = c.context as SelectorParserContext;

  if (
    context.pseudoClassTailElement !== undefined ||
    consumeAmpersandDelim(c) === null
  ) {
    return null;
  }

  const expanded = context.nestingSelectorExpansion ?? null;

  return {
    kind: SelectorKind.NestingSelector,
    expanded,
    specificity: expanded?.specificity ?? Specificity0,
  };
}

function createNestingSelectorExpansion(
  parent: SelectorList,
): PseudoClassSelector {
  const arms: ComplexRealSelector[] = [];

  for (const selector of parent.arms) {
    const parts: ComplexRealSelector['parts'] = [];

    for (const part of selector.parts) {
      if (
        part.unit.compound === null ||
        part.unit.pseudoCompounds.length > 0
      ) {
        parts.length = 0;
        break;
      }

      parts.push({
        combinator: part.combinator,
        compound: part.unit.compound,
      });
    }

    if (parts.length > 0) {
      arms.push({
        kind: SelectorKind.ComplexRealSelector,
        parts,
        specificity: selector.specificity,
      });
    }
  }

  const selectors: ComplexRealSelectorList = {
    kind: SelectorKind.ComplexRealSelectorList,
    arms,
    specificity: listSpecificity(arms),
  };

  return {
    kind: SelectorKind.PseudoClassSelector,
    name: 'is',
    argument: {
      kind: PseudoArgumentKind.ForgivingSelectorList,
      selectors,
    },
    // `&` inherits the maximum specificity of the complete parent list,
    // including parent arms that cannot be represented by :is().
    specificity: parent.specificity,
  };
}

function containsAmpersand(values: readonly ComponentValue[]): boolean {
  for (const value of values) {
    if (isDelimToken(value, '&')) return true;
    if (isComponentBlock(value) && containsAmpersand(value.value)) return true;
  }

  return false;
}

/*
 * <subclass-selector> =
 *   <id-selector> | <class-selector> |
 *   <attribute-selector> | <pseudo-class-selector>
 *
 * The nesting selector shares the subclass position because its parent
 * selector expansion behaves like :is().
 */
export type SubclassSelector =
  | NestingSelector
  | IdSelector
  | ClassSelector
  | AttributeSelector
  | PseudoClassSelector;

function consumeSubclassSelector(c: TokenCursor): TryConsumerResult<SubclassSelector> {
  return subclassSelectorConsumer(c);
}

const subclassSelectorConsumer: TryConsumer<SubclassSelector> = oneOf(
  [
    one(consumeNestingSelector),
    one(consumeIdSelector),
    one(consumeClassSelector),
    one(consumeAttributeSelector),
    one(consumePseudoClassSelector),
  ],
  ([selector]) => selector,
);

/*
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

function consumeIdSelector(c: TokenCursor): TryConsumerResult<IdSelector> {
  const ctx = c.context as SelectorParserContext;

  if (ctx.pseudoClassTailElement !== undefined) {
    return null;
  }

  return idSelectorConsumer(c);
}

const idSelectorConsumer: TryConsumer<IdSelector> = adaptConsumer(
  consumeIdHashToken,
  (hash) => ({
    kind: SelectorKind.IdSelector,
    name: hash.value,
    specificity: SpecificityA,
  }),
);

/*
 * <class-selector> = '.' <ident-token>
 */
export type ClassSelector = {
  kind: SelectorKind.ClassSelector;
  name: string;
  specificity: Specificity;
};

function consumeClassSelector(c: TokenCursor): TryConsumerResult<ClassSelector> {
  const ctx = c.context as SelectorParserContext;

  if (ctx.pseudoClassTailElement !== undefined) {
    return null;
  }

  return classSelectorConsumer(c);
}

const classSelectorConsumer: TryConsumer<ClassSelector> = sequenceOf(
  [
    one(consumeDotDelim),
    one(consumeIdentToken),
  ],

  ([, [ident]]) => ({
    kind: SelectorKind.ClassSelector,
    name: ident.value,
    specificity: SpecificityB,
  }),
);

/*
 * <attribute-selector> =
 *   '[' <wq-name> ']' |
 *   '[' <wq-name> <attr-matcher>
 *       [ <string-token> | <ident-token> ] <attr-modifier>? ']'
 *
 * Component-value tokenization represents the brackets and their contents as
 * one bracket block. attributeSelectorConsumer unwraps that block, and
 * attributeSelectorBodyConsumer parses the grammar between the brackets.
 */
export type AttributeSelector = {
  kind: SelectorKind.AttributeSelector;
  wqName: WqName;
  matcher: AttrMatcher | null;
  value: string | null;
  modifier: AttrModifier | null;
  specificity: Specificity;
};

function consumeAttributeSelector(c: TokenCursor): TryConsumerResult<AttributeSelector> {
  const ctx = c.context as SelectorParserContext;

  if (ctx.pseudoClassTailElement !== undefined) {
    return null;
  }

  return attributeSelectorConsumer(c);
}

// Bracket contents: <wq-name> [ <attr-matcher> <attr-value> <attr-modifier>? ]?
const attributeSelectorBodyConsumer: TryConsumer<AttributeSelector> = sequenceOf(
  [
    one(withTrivia(consumeWqName)),
    opt(
      sequenceOf(
        [
          one(withTrivia(consumeAttrMatcher)),
          one(withTrivia(consumeAttrValue)),
          opt(withTrivia(consumeAttrModifier)),
        ],
        ([[matcher], [value], modifier]) => ({
          matcher,
          value,
          modifier: modifier[0] ?? null,
        }),
      ),
    ),
  ],
  ([[wqName], tail]) => ({
    kind: SelectorKind.AttributeSelector,
    wqName,
    matcher: tail[0]?.matcher ?? null,
    value: tail[0]?.value ?? null,
    modifier: tail[0]?.modifier ?? null,
    specificity: SpecificityB,
  }),
);

const attributeSelectorConsumer = adaptConsumer(
  consumeBracketBlock,
  (block, context) =>
    parseAsComponentGrammar(block.value, attributeSelectorBodyConsumer, context),
);

/*
 * <attr-matcher> = [ '~' | '|' | '^' | '$' | '*' ]? '='
 */
export type AttrMatcher = '=' | '~=' | '|=' | '^=' | '$=' | '*=';

function consumeAttrMatcher(c: TokenCursor): TryConsumerResult<AttrMatcher> {
  return attrMatcherConsumer(c);
}

const attrMatcherConsumer: TryConsumer<AttrMatcher> = sequenceOf(
  [
    opt(oneOf(
      [
        one(consumeTildeDelim),
        one(consumePipeDelim),
        one(consumeCaretDelim),
        one(consumeDollarDelim),
        one(consumeAsteriskDelim),
      ],
      ([prefix]) => prefix,
    )),
    one(consumeEqualsDelim),
  ],
  ([prefix]) => `${prefix[0] ?? ''}=` as AttrMatcher,
);

/*
 * <attr-value> = [ <string-token> | <ident-token> ]
 */
function consumeAttrValue(c: TokenCursor): TryConsumerResult<string> {
  return attrValueConsumer(c);
}

const attrValueConsumer: TryConsumer<string> = oneOf(
  [
    one(consumeStringToken),
    one(consumeIdentToken),
  ],
  ([token]) => token.value,
);

/*
 * <attr-modifier> = i | s
 */
export type AttrModifier = 'i' | 's';

function consumeAttrModifier(c: TokenCursor): TryConsumerResult<AttrModifier> {
  return attrModifierConsumer(c);
}

// <attr-modifier> = i | s
const attrModifierConsumer = createKeywordConsumer('i', 's');

/*
 * <pseudo-class-selector> =
 *   : <ident-token> |
 *   : <function-token> <any-value> )
 *
 * Representing functional notation using the parser's component-value
 * function block, while retaining the required <any-value>, gives:
 *
 *   <pseudo-class-selector> =
 *     : <ident-token> |
 *     : <any-value-function-block>
 */
export type PseudoClassSelector = {
  kind: SelectorKind.PseudoClassSelector;
  name: string;
  argument: PseudoArgument | null;
  specificity: Specificity;
};

function consumePseudoClassSelector(c: TokenCursor): TryConsumerResult<PseudoClassSelector> {
  return pseudoClassSelectorConsumer(c);
}

// <pseudo-class-selector> = : [ <ident-token> | <any-value-function-block> ]
const pseudoClassSelectorConsumer: TryConsumer<PseudoClassSelector> = sequenceOf(
  [
    one(consumeColon),
    one(oneOf(
      [one(consumeIdentToken), one(consumeAnyValueFunctionBlock)],
      ([value], ctx) => value.type === TokenKind.Ident
        ? createPseudoClassSelector(value.value, null, ctx as SelectorParserContext)
        : createPseudoClassSelector(
          value.name,
          value.value.components,
          ctx as SelectorParserContext,
        ),
    )),
  ],
  ([, [selector]]) => selector,
);

/*
 * <pseudo-element-selector> =
 *   : <pseudo-class-selector> | <legacy-pseudo-element-selector>
 *
 * Expanding <pseudo-class-selector>, and representing functional notation
 * using the parser's component-value function block, while retaining its
 * required <any-value>, gives:
 *
 *   <pseudo-element-selector> =
 *     <legacy-pseudo-element-selector> |
 *     : : <ident-token> |
 *     : : <any-value-function-block>
 */
export type PseudoElementSelector = {
  kind: SelectorKind.PseudoElementSelector;
  name: string;
  argument: PseudoArgument | null;
  specificity: Specificity;
};

function consumePseudoElementSelector(c: TokenCursor): TryConsumerResult<PseudoElementSelector> {
  return pseudoElementSelectorConsumer(c);
}

const pseudoElementSelectorConsumer: TryConsumer<PseudoElementSelector> = oneOf(
  [
    one(consumeLegacyPseudoElementSelector),
    one(
      sequenceOf(
        [
          one(consumeColon),
          one(consumeColon),
          one(oneOf(
            [one(consumeIdentToken), one(consumeAnyValueFunctionBlock)],
            ([value], ctx) => value.type === TokenKind.Ident
              ? createPseudoElementSelector(value.value, null, false, ctx as SelectorParserContext)
              : createPseudoElementSelector(
                value.name,
                value.value.components,
                false,
                ctx as SelectorParserContext,
              ),
          )),
        ],
        ([, , [selector]]) => selector,
      ),
    ),
  ],
  ([selector]) => selector,
);

/*
 * <legacy-pseudo-element-selector> =
 *   : [before | after | first-line | first-letter]
 */
type LegacyPseudoElementName =
  | 'before'
  | 'after'
  | 'first-line'
  | 'first-letter';

function consumeLegacyPseudoElementSelector(c: TokenCursor): TryConsumerResult<PseudoElementSelector> {
  return legacyPseudoElementSelectorConsumer(c);
}

// <legacy-pseudo-element-selector> = : [before | after | first-line | first-letter]
const legacyPseudoElementSelectorConsumer: TryConsumer<PseudoElementSelector> = sequenceOf(
  [
    one(consumeColon),
    one(createKeywordConsumer('before', 'after', 'first-line', 'first-letter')),
  ],
  ([, [name]], ctx) =>
    createPseudoElementSelector(name, null, true, ctx as SelectorParserContext),
);

function isLegacyPseudoElementName(value: string): value is LegacyPseudoElementName {
  return (
    value === 'before' || value === 'after' || value === 'first-line' || value === 'first-letter'
  );
}

// --------------------------------------
// Pseudo-class selectors
// --------------------------------------

export type PseudoClassName =
  // Logical combination pseudo-classes
  | 'is' | 'where' | 'not' | 'has'

  // Elemental / linguistic / location pseudo-classes
  | 'defined' | 'state'
  | 'dir' | 'lang'
  | 'any-link' | 'link' | 'visited' | 'target' | 'local-link' | 'scope'

  // User action pseudo-classes
  | 'hover' | 'active' | 'focus' | 'focus-visible' | 'focus-within'
  | 'interest-source' | 'interest-target'

  // Resource state pseudo-classes
  | 'playing' | 'paused' | 'seeking' | 'buffering' | 'stalled' | 'muted' | 'volume-locked'

  // Element display state pseudo-classes
  | 'open' | 'popover-open' | 'modal' | 'fullscreen' | 'picture-in-picture'

  // Input pseudo-classes
  | 'enabled' | 'disabled' | 'read-only' | 'read-write' | 'placeholder-shown' | 'autofill'
  | 'default' | 'checked' | 'unchecked' | 'indeterminate'
  | 'valid' | 'invalid' | 'in-range' | 'out-of-range'
  | 'required' | 'optional' | 'user-valid' | 'user-invalid' | 'blank'

  // Time-dimensional pseudo-classes
  | 'current' | 'past' | 'future'

  // Heading pseudo-classes
  | 'heading'

  // Tree-structural pseudo-classes
  | 'root' | 'empty'
  | 'nth-child' | 'nth-last-child' | 'first-child' | 'last-child' | 'only-child'
  | 'nth-of-type' | 'nth-last-of-type' | 'first-of-type' | 'last-of-type' | 'only-of-type'

  // Grid-structural pseudo-classes
  | 'nth-col' | 'nth-last-col'

  // Shadow pseudo-classes
  | 'host' | 'host-context' | 'has-slotted';

// Removed Selectors Level 4 draft pseudo-classes.
// :target-within was removed in favor of :has(:target).
// Drag-and-drop pseudo-classes such as :drop() were dropped.
function canonicalPseudoClassName(rawName: string): PseudoClassName | null {
  const name = asciiLower(rawName);

  switch (name) {
    // Aliases
    case 'matches':
      return 'is';
    case '-webkit-autofill':
      return 'autofill';

    case 'is': case 'where': case 'not': case 'has':
    case 'defined': case 'state':
    case 'dir': case 'lang':
    case 'any-link': case 'link': case 'visited': case 'target': case 'local-link': case 'scope':
    case 'hover': case 'active': case 'focus': case 'focus-visible': case 'focus-within':
    case 'interest-source': case 'interest-target':
    case 'playing': case 'paused': case 'seeking': case 'buffering':
    case 'stalled': case 'muted': case 'volume-locked':
    case 'open': case 'popover-open': case 'modal': case 'fullscreen': case 'picture-in-picture':
    case 'enabled': case 'disabled': case 'read-only': case 'read-write': case 'placeholder-shown':
    case 'autofill': case 'default': case 'checked': case 'unchecked': case 'indeterminate':
    case 'valid': case 'invalid': case 'in-range': case 'out-of-range':
    case 'required': case 'optional': case 'user-valid': case 'user-invalid': case 'blank':
    case 'current': case 'past': case 'future':
    case 'heading':
    case 'root': case 'empty':
    case 'nth-child': case 'nth-last-child': case 'first-child': case 'last-child': case 'only-child':
    case 'nth-of-type': case 'nth-last-of-type':
    case 'first-of-type': case 'last-of-type': case 'only-of-type':
    case 'nth-col': case 'nth-last-col':
    case 'host': case 'host-context': case 'has-slotted':
      return name;

    default:
      return null;
  }
}

function createPseudoClassSelector(
  rawName: string,
  value: readonly ComponentValue[] | null,
  context: SelectorParserContext,
): TryConsumerResult<PseudoClassSelector> {
  const name = canonicalPseudoClassName(rawName);

  if (name === null) {
    return null;
  }

  const pseudoElement = context.pseudoClassTailElement;

  if (
    pseudoElement !== undefined &&
    !isValidPseudoClassAfterPseudoElement(pseudoElement, name)
  ) {
    return null;
  }

  switch (name) {
    // Logical combination pseudo-classes

    case 'is': {
      if (value === null) return null;

      const argument = parseForgivingSelectorListArgument(value, context);

      return {
        kind: SelectorKind.PseudoClassSelector,
        name,
        argument,
        specificity: argument.selectors.specificity,
      };
    }

    case 'where': {
      if (value === null) return null;

      const argument = parseForgivingSelectorListArgument(value, context);

      return {
        kind: SelectorKind.PseudoClassSelector,
        name,
        argument,
        specificity: Specificity0,
      };
    }

    case 'not': {
      if (value === null) return null;

      const selectors = parseStrictComplexRealSelectorListArgument(value, context);

      if (selectors === null) return null;

      const argument: ComplexRealSelectorListPseudoArgument = {
        kind: PseudoArgumentKind.ComplexRealSelectorList,
        selectors,
      };

      return {
        kind: SelectorKind.PseudoClassSelector,
        name,
        argument,
        specificity: argument.selectors.specificity,
      };
    }

    case 'has': {
      if (
        value === null ||
        context.insideHas === true ||
        context.selectorRestriction === 'compound' ||
        context.selectorRestriction === 'simple'
      ) return null;

      const argumentContext: SelectorParserContext = {
        ...contextForSelectorArgument(context),
        insideHas: true,
      };

      const selectors = parseRelativeSelectorList(
        value,
        argumentContext,
      );
      if (selectors === null) return null;

      const argument: RelativeSelectorListPseudoArgument = {
        kind: PseudoArgumentKind.RelativeSelectorList,
        selectors,
      };

      return {
        kind: SelectorKind.PseudoClassSelector,
        name,
        argument,
        specificity: argument.selectors.specificity,
      };
    }

    // Elemental pseudo-classes

    case 'defined': {
      return createNoArgumentPseudoClassSelector(name, value);
    }

    case 'state': {
      return createArgumentPseudoClassSelector(name, value, context, parseIdentArgument);
    }

    // Linguistic pseudo-classes

    case 'dir': {
      return createArgumentPseudoClassSelector(name, value, context, parseDirectionArgument);
    }

    case 'lang': {
      return createArgumentPseudoClassSelector(name, value, context, parseLanguageRangeListArgument);
    }

    // Location pseudo-classes

    case 'any-link':
    case 'link':
    case 'visited':
    case 'target': {
      return createNoArgumentPseudoClassSelector(name, value);
    }

    case 'local-link': {
      if (value === null) {
        return createNoArgumentPseudoClassSelector(name, value);
      }

      return createArgumentPseudoClassSelector(
        name,
        value,
        context,
        parseNonNegativeIntegerArgument,
      );
    }

    case 'scope': {
      return createNoArgumentPseudoClassSelector(name, value, SpecificityB);
    }

    // User action pseudo-classes

    case 'hover':
    case 'active':
    case 'focus':
    case 'focus-visible':
    case 'focus-within':
    case 'interest-source':
    case 'interest-target': {
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
    case 'user-invalid':
    case 'blank': {
      return createNoArgumentPseudoClassSelector(name, value);
    }

    // Time-dimensional pseudo-classes

    case 'current': {
      if (value === null) {
        return createNoArgumentPseudoClassSelector(name, value);
      }

      return createArgumentPseudoClassSelector(
        name,
        value,
        context,
        parseCompoundSelectorListArgument,
      );
    }

    case 'past':
    case 'future': {
      return createNoArgumentPseudoClassSelector(name, value);
    }

    // Heading pseudo-classes

    case 'heading': {
      if (value === null) {
        return createNoArgumentPseudoClassSelector(name, value);
      }

      return createArgumentPseudoClassSelector(name, value, context, parseIntegerListArgument);
    }

    // Tree-structural pseudo-classes

    case 'root':
    case 'empty': {
      return createNoArgumentPseudoClassSelector(name, value);
    }

    case 'nth-child':
    case 'nth-last-child': {
      return createArgumentPseudoClassSelector(
        name,
        value,
        context,
        parseNthChildArgument,
        (argument) => addSpecificity(
          SpecificityB,
          argument.of?.specificity ?? Specificity0,
        ),
      );
    }

    case 'first-child':
    case 'last-child':
    case 'only-child': {
      return createNoArgumentPseudoClassSelector(name, value);
    }

    case 'nth-of-type':
    case 'nth-last-of-type': {
      return createArgumentPseudoClassSelector(name, value, context, parseAnPlusBArgument);
    }

    case 'first-of-type':
    case 'last-of-type':
    case 'only-of-type': {
      return createNoArgumentPseudoClassSelector(name, value);
    }

    // Grid-structural pseudo-classes

    case 'nth-col':
    case 'nth-last-col': {
      return createArgumentPseudoClassSelector(name, value, context, parseAnPlusBArgument);
    }

    // Shadow pseudo-classes

    case 'host': {
      if (value === null) {
        return {
          kind: SelectorKind.PseudoClassSelector,
          name,
          argument: null,
          specificity: SpecificityB,
        };
      }

      const selector = parseRestrictedCompoundSelectorArgument(
        value,
        context,
      );
      if (selector === null) return null;

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
      };
    }

    case 'host-context': {
      if (value === null) return null;

      const selector = parseRestrictedCompoundSelectorArgument(
        value,
        context,
      );
      if (selector === null) return null;

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
): TryConsumerResult<PseudoClassSelector> {
  if (value !== null) {
    return null;
  }

  return {
    kind: SelectorKind.PseudoClassSelector,
    name,
    argument: null,
    specificity,
  };
}

function createArgumentPseudoClassSelector<T extends PseudoArgument>(
  name: PseudoClassName,
  value: readonly ComponentValue[] | null,
  context: SelectorParserContext,
  parseArgument: PseudoArgumentParser<T>,
  specificity: Specificity | ((argument: T) => Specificity) = SpecificityB,
): TryConsumerResult<PseudoClassSelector> {
  if (value === null) return null;

  const argument = parseArgument(value, context);
  if (argument === null) return null;

  return {
    kind: SelectorKind.PseudoClassSelector,
    name,
    argument,
    specificity: typeof specificity === 'function'
      ? specificity(argument)
      : specificity,
  };
}

// --------------------------------------
// Pseudo-element selectors
// --------------------------------------

export type PseudoElementName =
  // Typographic pseudo-elements
  | 'first-line' | 'first-letter' | 'prefix' | 'suffix'

  // Highlight pseudo-elements
  | 'selection' | 'search-text' | 'target-text' | 'spelling-error' | 'grammar-error' | 'highlight'

  // Generated / marker / input pseudo-elements
  | 'before' | 'after' | 'marker' | 'placeholder'

  // Element-backed pseudo-elements
  | 'file-selector-button' | 'details-content'

  // Shadow pseudo-elements
  | 'slotted' | 'part';

function canonicalPseudoElementName(rawName?: string): PseudoElementName | null {
  if (rawName === undefined) return null;
  const name = asciiLower(rawName);

  switch (name) {
    case 'first-line': case 'first-letter': case 'prefix': case 'suffix':
    case 'selection': case 'search-text': case 'target-text':
    case 'spelling-error': case 'grammar-error': case 'highlight':
    case 'before': case 'after': case 'marker': case 'placeholder':
    case 'file-selector-button': case 'details-content':
    case 'slotted': case 'part':
      return name;

    default:
      return null;
  }
}

function createPseudoElementSelector(
  rawName: string,
  value: readonly ComponentValue[] | null,
  legacy: boolean,
  context: SelectorParserContext,
): TryConsumerResult<PseudoElementSelector> {
  const name = canonicalPseudoElementName(rawName);

  if (name === null) {
    return null;
  }

  if (context.insideHas === true && !isHasAllowedPseudoElement(name)) {
    return null;
  }

  switch (name) {
    // Typographic pseudo-elements

    case 'first-line':
    case 'first-letter': {
      return createNoArgumentPseudoElementSelector(name, value, legacy);
    }

    // Sub-pseudo-elements of ::first-letter.
    // Valid in chains like ::first-letter::prefix / ::first-letter::suffix.
    // Placement is validated by consumePseudoCompoundSelector.

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

      const ident = parseCustomIdent(value, [], context);

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

      const selector = parseRestrictedCompoundSelectorArgument(
        value,
        context,
      );

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
      };
    }

    case 'part': {
      if (legacy || value === null) {
        return null;
      }

      const argument = parsePartNameListArgument(value, context);

      if (argument === null) {
        return null;
      }

      return {
        kind: SelectorKind.PseudoElementSelector,
        name,
        argument,
        specificity: SpecificityC,
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
): TryConsumerResult<PseudoElementSelector> {
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
  };
}

// --------------------------------------
// Pseudo arguments
// --------------------------------------

export enum PseudoArgumentKind {
  ForgivingSelectorList = 'forgiving-selector-list',
  ComplexRealSelectorList = 'complex-real-selector-list',
  RelativeSelectorList = 'relative-selector-list',
  CompoundSelectorList = 'compound-selector-list',
  CompoundSelector = 'compound-selector',
  Direction = 'direction',
  LanguageRangeList = 'language-range-list',
  AnPlusB = 'an-plus-b',
  NthChild = 'nth-child',
  Ident = 'ident',
  Integer = 'integer',
  IntegerList = 'integer-list',
  PartNameList = 'part-name-list',
  CustomIdent = 'custom-ident',
}

type PseudoArgument =
  | ForgivingSelectorListPseudoArgument
  | ComplexRealSelectorListPseudoArgument
  | RelativeSelectorListPseudoArgument
  | CompoundSelectorListPseudoArgument
  | CompoundSelectorPseudoArgument
  | DirectionPseudoArgument
  | LanguageRangeListPseudoArgument
  | AnPlusBPseudoArgument
  | NthChildPseudoArgument
  | IdentPseudoArgument
  | IntegerPseudoArgument
  | IntegerListPseudoArgument
  | PartNameListPseudoArgument
  | CustomIdentPseudoArgument;

type PseudoArgumentParser<T extends PseudoArgument> = (
  value: readonly ComponentValue[],
  context: SelectorParserContext,
) => T | null;

type ForgivingSelectorListPseudoArgument = {
  kind: PseudoArgumentKind.ForgivingSelectorList;
  selectors: ForgivingSelectorList;
};

export type ForgivingSelectorList = {
  kind: SelectorKind.ComplexRealSelectorList;
  arms: ForgivingSelectorArm[];
  specificity: Specificity;
};

type ForgivingSelectorArm = ComplexRealSelector | UnparsedSelector;

export type UnparsedSelector = {
  kind: SelectorKind.UnparsedSelector;
  value: readonly ComponentValue[];
  hasAmpersand: boolean;
};

type RelativeSelectorListPseudoArgument = {
  kind: PseudoArgumentKind.RelativeSelectorList;
  selectors: RelativeSelectorList;
};

type ComplexRealSelectorListPseudoArgument = {
  kind: PseudoArgumentKind.ComplexRealSelectorList;
  selectors: ComplexRealSelectorList;
};

type CompoundSelectorListPseudoArgument = {
  kind: PseudoArgumentKind.CompoundSelectorList;
  selectors: CompoundSelectorList;
};

type CompoundSelectorPseudoArgument = {
  kind: PseudoArgumentKind.CompoundSelector;
  selector: CompoundSelector;
};

type IdentPseudoArgument = {
  kind: PseudoArgumentKind.Ident;
  value: string;
};

// --------------------------------------
// Selector-valued arguments
// --------------------------------------

function parseForgivingSelectorListArgument(
  arg: readonly ComponentValue[],
  context: SelectorParserContext,
): ForgivingSelectorListPseudoArgument {
  const argumentContext = contextForSelectorArgument(context);
  const parseSelector = parserForSelectorRestriction(argumentContext);
  const values = parseCommaSeparatedListOfComponentValues(arg);
  const arms: ForgivingSelectorArm[] = values.map((value) => {
    const selector = parseAsComponentGrammar(
      value,
      withTrivia(parseSelector),
      argumentContext,
    );

    return selector ?? {
      kind: SelectorKind.UnparsedSelector,
      value,
      hasAmpersand: containsAmpersand(value),
    };
  });

  return {
    kind: PseudoArgumentKind.ForgivingSelectorList,
    selectors: {
      kind: SelectorKind.ComplexRealSelectorList,
      arms,
      specificity: listSpecificity(arms.filter(
        (arm): arm is ComplexRealSelector =>
          arm.kind !== SelectorKind.UnparsedSelector,
      )),
    },
  };
}

function parseStrictComplexRealSelectorListArgument(
  arg: readonly ComponentValue[],
  context: SelectorParserContext,
): TryConsumerResult<ComplexRealSelectorList> {
  const argumentContext = contextForSelectorArgument(context);
  const parseSelector = parserForSelectorRestriction(argumentContext);

  const parsed = parseListAsComponentGrammar(
    arg,
    withTrivia(parseSelector),
    argumentContext,
  );

  const arms: ComplexRealSelector[] = [];

  for (const result of parsed) {
    if (result === null) {
      return null;
    }

    arms.push(result);
  }

  if (arms.length === 0) {
    return null;
  }

  return {
    kind: SelectorKind.ComplexRealSelectorList,
    arms,
    specificity: listSpecificity(arms),
  };
}

function parseRestrictedCompoundSelectorArgument(
  value: readonly ComponentValue[],
  context: SelectorParserContext,
): CompoundSelector | null {
  const argumentContext = contextForSelectorArgument(context, 'compound');

  if (argumentContext.selectorRestriction !== 'simple') {
    return parseCompoundSelector(value, argumentContext);
  }

  const selector = parseSimpleSelector(value, argumentContext);

  if (selector === null) {
    return null;
  }

  return {
    kind: SelectorKind.CompoundSelector,
    typeSelector: selector.kind === SelectorKind.TypeSelector ? selector : null,
    subclasses: selector.kind === SelectorKind.TypeSelector ? [] : [selector],
    specificity: selector.specificity,
  };
}

function parseCompoundSelectorListArgument(
  value: readonly ComponentValue[],
  context: SelectorParserContext,
): CompoundSelectorListPseudoArgument | null {
  const selectors = parseCompoundSelectorList(
    value,
    contextForSelectorArgument(context, 'compound'),
  );

  if (selectors === null) {
    return null;
  }

  return {
    kind: PseudoArgumentKind.CompoundSelectorList,
    selectors,
  };
}

function parserForSelectorRestriction(
  context: SelectorParserContext,
): TryConsumer<ComplexRealSelector> {
  switch (context.selectorRestriction) {
    case 'simple':
      return simpleAsComplexRealSelectorConsumer;
    case 'compound':
      return compoundAsComplexRealSelectorConsumer;
    case 'complex-real':
    case undefined:
      return consumeComplexRealSelector;
  }
}

const compoundAsComplexRealSelectorConsumer = adaptConsumer(
  consumeCompoundSelector,
  (result): ComplexRealSelector => ({
    kind: SelectorKind.ComplexRealSelector,
    parts: [
      {
        combinator: null,
        compound: result,
      },
    ],
    specificity: result.specificity,
  }),
);

const simpleAsComplexRealSelectorConsumer = adaptConsumer(
  consumeSimpleSelector,
  (selector): ComplexRealSelector => {
    const compound: CompoundSelector = {
      kind: SelectorKind.CompoundSelector,
      typeSelector: selector.kind === SelectorKind.TypeSelector ? selector : null,
      subclasses: selector.kind === SelectorKind.TypeSelector ? [] : [selector],
      specificity: selector.specificity,
    };

    return {
      kind: SelectorKind.ComplexRealSelector,
      parts: [{ combinator: null, compound }],
      specificity: compound.specificity,
    };
  },
);

// --------------------------------------
// An+B arguments
// --------------------------------------

type AnPlusBPseudoArgument = {
  kind: PseudoArgumentKind.AnPlusB;
} & AnPlusBValue;

type NthChildPseudoArgument = {
  kind: PseudoArgumentKind.NthChild;
  formula: AnPlusBValue;
  of: ComplexRealSelectorList | null;
};

function parseAnPlusBArgument(
  value: readonly ComponentValue[],
  context: SelectorParserContext,
): AnPlusBPseudoArgument | null {
  const anb = parseAsComponentGrammar(value, withTrivia(consumeAnPlusB), context);

  if (anb === null) {
    return null;
  }

  return {
    kind: PseudoArgumentKind.AnPlusB,
    ...anb,
  };
}

function parseNthChildArgument(
  value: readonly ComponentValue[],
  context: SelectorParserContext,
): NthChildPseudoArgument | null {
  return parseAsComponentGrammar(value, consumeNthChildArgument, context);
}

function consumeNthChildArgument(c: TokenCursor): TryConsumerResult<NthChildPseudoArgument> {
  return nthChildArgumentConsumer(c);
}

const nthChildArgumentConsumer = sequenceOf(
  [
    one(withTrivia(consumeAnPlusB)),
    opt(consumeNthChildOfClause),
  ],
  ([[formula], of]): NthChildPseudoArgument => ({
    kind: PseudoArgumentKind.NthChild,
    formula,
    of: of[0] ?? null,
  }),
);

const ofIdentConsumer = createKeywordConsumer('of');

function consumeNthChildOfClause(c: TokenCursor): TryConsumerResult<ComplexRealSelectorList> {
  return nthChildOfClauseConsumer(c);
}

const nthChildOfClauseConsumer = sequenceOf(
  [
    one(withTrivia(ofIdentConsumer)),
    one(consumeNthChildOfSelectorList),
  ],
  ([, [selectors]]) => selectors,
);

function consumeNthChildOfSelectorList(
  c: TokenCursor,
): TryConsumerResult<ComplexRealSelectorList> {
  const outerContext = c.context as SelectorParserContext;
  const argumentContext = contextForSelectorArgument(outerContext);

  try {
    c.context = argumentContext;

    const armsConsumer = commaRepeat(parserForSelectorRestriction(argumentContext));
    const arms = withTrivia(armsConsumer)(c);

    if (arms === null) {
      return null;
    }

    return {
      kind: SelectorKind.ComplexRealSelectorList,
      arms,
      specificity: listSpecificity(arms),
    };
  } finally {
    c.context = outerContext;
  }
}

// --------------------------------------
// Identifier and integer arguments
// --------------------------------------

type IntegerPseudoArgument = {
  kind: PseudoArgumentKind.Integer;
  value: number;
};

type IntegerListPseudoArgument = {
  kind: PseudoArgumentKind.IntegerList;
  values: number[];
};

function parseIdentArgument(
  value: readonly ComponentValue[],
  context: SelectorParserContext,
): IdentPseudoArgument | null {
  const ident = parseAsComponentGrammar(value, withTrivia(consumeIdentToken), context);

  if (ident === null) {
    return null;
  }

  return {
    kind: PseudoArgumentKind.Ident,
    value: ident.value,
  };
}

function parseIntegerArgument(
  value: readonly ComponentValue[],
  context: SelectorParserContext,
): IntegerPseudoArgument | null {
  const integer = parseAsComponentGrammar(value, withTrivia(integerConsumer), context);

  if (integer === null) {
    return null;
  }

  return {
    kind: PseudoArgumentKind.Integer,
    value: integer,
  };
}

function parseNonNegativeIntegerArgument(
  value: readonly ComponentValue[],
  context: SelectorParserContext,
): IntegerPseudoArgument | null {
  const argument = parseIntegerArgument(value, context);
  return argument !== null && argument.value >= 0 ? argument : null;
}

function parseIntegerListArgument(
  value: readonly ComponentValue[],
  context: SelectorParserContext,
): IntegerListPseudoArgument | null {
  const parsed = parseAsComponentGrammar(
    value,
    commaRepeat(withTrivia(integerConsumer)),
    context,
  );
  if (parsed === null) return null;

  return {
    kind: PseudoArgumentKind.IntegerList,
    values: parsed,
  };
}

const integerConsumer = adaptConsumer(
  consumeIntegerToken,
  (token) => token.value,
);

// --------------------------------------
// Language-range-list arguments
// --------------------------------------

type LanguageRangeListPseudoArgument = {
  kind: PseudoArgumentKind.LanguageRangeList;
  ranges: LanguageRange[];
};

type LanguageRange = string;


function parseLanguageRangeListArgument(
  value: readonly ComponentValue[],
  context: SelectorParserContext,
): LanguageRangeListPseudoArgument | null {
  const parsed = parseAsComponentGrammar(
    value,
    commaRepeat(withTrivia(languageRangeConsumer)),
    context,
  );
  if (parsed === null) return null;

  return {
    kind: PseudoArgumentKind.LanguageRangeList,
    ranges: parsed,
  };
}

const languageRangeConsumer: TryConsumer<LanguageRange> = oneOf(
  [
    one(consumeIdentToken),
    one(consumeStringToken),
  ],
  ([token]) => token.value,
);

// --------------------------------------
// Direction arguments
// --------------------------------------

type DirectionPseudoArgument = {
  kind: PseudoArgumentKind.Direction;
  value: string;
};

function parseDirectionArgument(
  value: readonly ComponentValue[],
  context: SelectorParserContext,
): DirectionPseudoArgument | null {
  const parsed = parseAsComponentGrammar(value, withTrivia(consumeIdentToken), context);

  if (parsed === null) {
    return null;
  }

  return {
    kind: PseudoArgumentKind.Direction,
    value: parsed.value,
  };
}

// --------------------------------------
// Part-name-list arguments
// --------------------------------------

type PartNameListPseudoArgument = {
  kind: PseudoArgumentKind.PartNameList;
  names: string[];
};

function parsePartNameListArgument(
  value: readonly ComponentValue[],
  context: SelectorParserContext,
): PartNameListPseudoArgument | null {
  const names = parseAsComponentGrammar(value, consumePartNameList, context);

  if (names === null) {
    return null;
  }

  return {
    kind: PseudoArgumentKind.PartNameList,
    names,
  };
}

/*
 * <part-name-list> = <ident-token>+
 */
function consumePartNameList(c: TokenCursor): TryConsumerResult<string[]> {
  return partNameListConsumer(c);
}

const partNameListConsumer: TryConsumer<string[]> = plus(
  withTrivia(adaptConsumer(consumeIdentToken, ({ value }) => value)),
);

// --------------------------------------
// Custom-ident arguments
// --------------------------------------

type CustomIdentPseudoArgument = {
  kind: PseudoArgumentKind.CustomIdent;
  value: CustomIdentValue;
};

// --------------------------------------
// Pseudo-selector policy
// --------------------------------------

// Pseudo-class tails

function isValidPseudoClassAfterPseudoElement(
  pseudoElementName: PseudoElementName,
  pseudoClassName: PseudoClassName,
): boolean {
  if (isElementBackedPseudoElement(pseudoElementName)) {
    return true;
  }

  return isDefaultValidTailPseudoClass(pseudoClassName);
}

function isDefaultValidTailPseudoClass(name: PseudoClassName): boolean {
  switch (name) {
    // User action pseudo-classes
    case 'hover': case 'active': case 'focus': case 'focus-visible': case 'focus-within':
    case 'interest-source': case 'interest-target':
      return true;

    // Logical pseudo-classes that inherit the pseudo-element tail context
    case 'is': case 'where': case 'not':
      return true;

    default:
      return false;
  }
}

// Pseudo-element classification

function isElementBackedPseudoElement(
  pseudoElement: PseudoElementName,
): boolean {
  switch (pseudoElement) {
    case 'file-selector-button':
    case 'details-content':
    case 'part':
      return true;

    default:
      return false;
  }
}

function isTreeAbidingPseudoElement(
  pseudoElement: PseudoElementName,
): boolean {
  if (isElementBackedPseudoElement(pseudoElement)) {
    return true;
  }

  switch (pseudoElement) {
    case 'before':
    case 'after':
    case 'marker':
    case 'placeholder':
      return true;

    default:
      return false;
  }
}

// Pseudo-element placement and chaining

function isValidSubPseudoElement(
  origin: PseudoElementName | undefined,
  candidate: PseudoElementName,
): boolean {
  if (origin === undefined) {
    return candidate !== 'prefix' && candidate !== 'suffix';
  }

  if (isElementBackedPseudoElement(origin)) {
    return true;
  }

  switch (origin) {
    case 'first-letter':
      return candidate === 'prefix' || candidate === 'suffix';

    case 'before':
    case 'after':
      return candidate === 'marker';

    case 'slotted':
      return isTreeAbidingPseudoElement(candidate);

    default:
      return false;
  }
}

function isHasAllowedPseudoElement(_pseudoElement: PseudoElementName): boolean {
  // Selectors 4 defines the opt-in hook, but no current pseudo-element uses it.
  return false;
}

function isValidCombinatorAfterPseudoElement(pseudoElement: PseudoElementName, combinator: Combinator): boolean {
  switch (combinator) {
    case ' ':
    case '>':
      return hasPseudoElementInternalStructure(pseudoElement);

    case '+':
    case '~':
    case '||':
      return false;
  }
}

function hasPseudoElementInternalStructure(_pseudoElement: PseudoElementName): boolean {
  return false;
}

// --------------------------------------
// Specificity
// --------------------------------------

export type Specificity = Readonly<{
  a: number;
  b: number;
  c: number;
}>;

const Specificity0: Specificity = Object.freeze({ a: 0, b: 0, c: 0 });
const SpecificityA: Specificity = Object.freeze({ a: 1, b: 0, c: 0 });
const SpecificityB: Specificity = Object.freeze({ a: 0, b: 1, c: 0 });
const SpecificityC: Specificity = Object.freeze({ a: 0, b: 0, c: 1 });

function addSpecificity(left: Specificity, right: Specificity): Specificity {
  if (left === Specificity0) return right;
  if (right === Specificity0) return left;

  return {
    a: left.a + right.a,
    b: left.b + right.b,
    c: left.c + right.c,
  };
}

function sumSpecificity(
  values: readonly (Specificity | null | undefined)[],
): Specificity {
  let specificity = Specificity0;

  for (const value of values) {
    if (value) {
      specificity = addSpecificity(specificity, value);
    }
  }

  return specificity;
}

function compareSpecificity(left: Specificity, right: Specificity): number {
  return left.a - right.a || left.b - right.b || left.c - right.c;
}

function maxSpecificity(values: readonly Specificity[]): Specificity {
  let max = Specificity0;

  for (const value of values) {
    if (compareSpecificity(value, max) > 0) {
      max = value;
    }
  }

  return max;
}

function listSpecificity(arms: { specificity: Specificity; }[]): Specificity {
  return maxSpecificity(arms.map((arm) => arm.specificity));
}



//  ██████  ████████ ████████  ████    ███    ██
// ██    ██ ██       ██     ██  ██    ██ ██   ██
// ██       ██       ██     ██  ██   ██   ██  ██
//  ██████  ██████   ████████   ██  ██     ██ ██
//       ██ ██       ██   ██    ██  █████████ ██
// ██    ██ ██       ██    ██   ██  ██     ██ ██
//  ██████  ████████ ██     ██ ████ ██     ██ ████████

// CSSOM, "serialize a group of selectors".
export function serializeSelectorList(selectors: SelectorList): string {
  return serializeComplexSelectorList(selectors);
}

// CSSOM, "serialize a selector".
export function serializeSelector(selector: ComplexSelector): string {
  return selector.parts.map(({ combinator, unit }) => {
    const serialized = serializeComplexSelectorUnit(unit);
    return combinator === null
      ? serialized
      : `${serializeCombinator(combinator)}${serialized}`;
  }).join('');
}

function serializeComplexSelectorList(selectors: SelectorList): string {
  return selectors.arms
    .map(serializeSelector)
    .join(', ');
}

function serializeComplexRealSelectorList(
  selectors: ComplexRealSelectorList,
): string {
  return selectors.arms
    .map(serializeComplexRealSelector)
    .join(', ');
}

function serializeForgivingSelectorList(
  selectors: ForgivingSelectorList,
): string {
  const serialized: string[] = [];

  for (const selector of selectors.arms) {
    if (selector.kind === SelectorKind.UnparsedSelector) {
      if (selector.hasAmpersand) {
        serialized.push(serializeComponentValues(selector.value).trim());
      }
    } else {
      serialized.push(serializeComplexRealSelector(selector));
    }
  }

  return serialized.join(', ');
}

function serializeCompoundSelectorList(
  selectors: CompoundSelectorList,
): string {
  return selectors.arms
    .map((selector) => serializeCompoundSelector(selector))
    .join(', ');
}

function serializeRelativeSelectorList(
  selectors: RelativeSelectorList,
): string {
  return selectors.arms
    .map(serializeRelativeSelector)
    .join(', ');
}

function serializeComplexRealSelector(
  selector: ComplexRealSelector,
): string {
  return selector.parts.map(({ combinator, compound }) => {
    const serialized = serializeCompoundSelector(compound);
    return combinator === null
      ? serialized
      : `${serializeCombinator(combinator)}${serialized}`;
  }).join('');
}

function serializeRelativeSelector(selector: RelativeSelector): string {
  const combinator = selector.combinator === null || selector.combinator === ' '
    ? ''
    : `${selector.combinator} `;
  return `${combinator}${serializeSelector(selector.selector)}`;
}

function serializeCombinator(combinator: Combinator): string {
  return combinator === ' ' ? ' ' : ` ${combinator} `;
}

function serializeComplexSelectorUnit(unit: ComplexSelectorUnit): string {
  const compound = unit.compound === null
    ? ''
    : serializeCompoundSelector(
      unit.compound,
      unit.pseudoCompounds.length > 0,
    );
  return compound + unit.pseudoCompounds
    .map(serializePseudoCompoundSelector)
    .join('');
}

function serializeCompoundSelector(
  selector: CompoundSelector,
  hasFollowingPseudo = false,
): string {
  const subclasses = selector.subclasses
    .map(serializeSubclassSelector)
    .join('');

  if (selector.typeSelector === null) return subclasses;

  const serializeUniversal = selector.subclasses.length === 0 && !hasFollowingPseudo;
  const type = serializeTypeSelector(
    selector.typeSelector,
    serializeUniversal,
  );
  return type + subclasses;
}

function serializeSubclassSelector(selector: SubclassSelector): string {
  switch (selector.kind) {
    case SelectorKind.NestingSelector:
      return '&';

    case SelectorKind.IdSelector:
      return `#${serializeCssIdentifier(selector.name)}`;

    case SelectorKind.ClassSelector:
      return `.${serializeCssIdentifier(selector.name)}`;

    case SelectorKind.AttributeSelector:
      return serializeAttributeSelector(selector);

    case SelectorKind.PseudoClassSelector:
      return serializePseudoClassSelector(selector);
  }
}

function serializeTypeSelector(
  selector: TypeSelector,
  serializeUniversal: boolean,
): string {
  if (
    selector.name === '*' &&
    !serializeUniversal &&
    !universalHasMeaningfulNamespace(selector.namespace)
  ) {
    return '';
  }

  return serializeTypeNamespace(selector.namespace) + (
    selector.name === '*' ? '*' : serializeCssIdentifier(selector.name)
  );
}

function serializeAttributeSelector(selector: AttributeSelector): string {
  const name = serializeAttributeName(selector.wqName);
  if (selector.matcher === null) return `[${name}]`;

  const modifier = selector.modifier === null ? '' : ` ${selector.modifier}`;
  return `[${name}${selector.matcher}${serializeCssString(selector.value!)}${modifier}]`;
}

function serializePseudoCompoundSelector(selector: PseudoCompoundSelector): string {
  return serializePseudoElementSelector(selector.pseudoElement) +
    selector.pseudoClasses
      .map(serializePseudoClassSelector)
      .join('');
}

function serializePseudoClassSelector(selector: PseudoClassSelector): string {
  const name = serializeCssIdentifier(selector.name);
  return selector.argument === null
    ? `:${name}`
    : `:${name}(${serializePseudoArgument(selector.argument)})`;
}

function serializePseudoElementSelector(selector: PseudoElementSelector): string {
  const name = serializeCssIdentifier(selector.name);
  return selector.argument === null
    ? `::${name}`
    : `::${name}(${serializePseudoArgument(selector.argument)})`;
}

function serializePseudoArgument(
  argument: NonNullable<PseudoClassSelector['argument']>,
): string {
  switch (argument.kind) {
    case PseudoArgumentKind.ForgivingSelectorList:
      return serializeForgivingSelectorList(argument.selectors);

    case PseudoArgumentKind.ComplexRealSelectorList:
      return serializeComplexRealSelectorList(argument.selectors);

    case PseudoArgumentKind.RelativeSelectorList:
      return serializeRelativeSelectorList(argument.selectors);

    case PseudoArgumentKind.CompoundSelectorList:
      return serializeCompoundSelectorList(argument.selectors);

    case PseudoArgumentKind.CompoundSelector:
      return serializeCompoundSelector(argument.selector);

    case PseudoArgumentKind.Direction:
      return serializeCssIdentifier(argument.value);

    case PseudoArgumentKind.LanguageRangeList:
      return argument.ranges.map(serializeCssString).join(', ');

    case PseudoArgumentKind.AnPlusB:
      return serializeAnPlusB(argument);

    case PseudoArgumentKind.NthChild: {
      const formula = serializeAnPlusB(argument.formula);
      return argument.of === null
        ? formula
        : `${formula} of ${serializeComplexRealSelectorList(argument.of)}`;
    }

    case PseudoArgumentKind.Ident:
      return serializeCssIdentifier(argument.value);

    case PseudoArgumentKind.Integer:
      return serializeCssInteger(argument.value);

    case PseudoArgumentKind.IntegerList:
      return argument.values.map(serializeCssInteger).join(', ');

    case PseudoArgumentKind.PartNameList:
      return argument.names.map(serializeCssIdentifier).join(' ');

    case PseudoArgumentKind.CustomIdent:
      return serializeCustomIdent(argument.value);

    default:
      return assertNever(argument);
  }
}

function serializeTypeNamespace(namespace: string | null): string {
  if (namespace === null) return '';
  if (namespace === '') return '|';
  if (namespace === '*') return '*|';
  return `${serializeCssIdentifier(namespace)}|`;
}

function serializeAttributeName(name: WqName): string {
  const namespace = name.namespace === null || name.namespace === ''
    ? ''
    : name.namespace === '*'
      ? '*|'
      : `${serializeCssIdentifier(name.namespace)}|`;
  return `${namespace}${serializeCssIdentifier(name.localName)}`;
}

function universalHasMeaningfulNamespace(namespace: string | null): boolean {
  return namespace !== null;
}
