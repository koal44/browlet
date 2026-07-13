import { asciiLower } from '../../utils/css';
import {
  any, commaRepeat, one, oneOf, opt, plus, sequenceOf, withComponentTrivia, requiredSequenceOf,
} from './component-grammar';
import type { ComponentCursor } from './component-cursor';
import {
  createDelimConsumer, createIdentValueConsumer,
  tryConsumeColon, tryConsumeFunctionBlock, tryConsumeIdentToken,
  tryConsumeIdHashToken, tryConsumeIntegerToken, tryConsumeStringToken,
} from './component-consumers';
import type { ComponentValue, ParserInput } from './syntax';
import {
  consumeComponentTrivia, isBracketBlock, isDelimToken, isIdentToken, isTokenKind,
  parseAsComponentGrammar, parseListAsComponentGrammar,
} from './syntax';
import { TokenKind } from './tokens';
import {
  addSpecificity, listSpecificity, SpecificityB, SpecificityA, SpecificityC, Specificity0, sumSpecificity,
  type Specificity,
} from './selector-specificity';
import { parseCustomIdent, type CustomIdentValue } from '../values/custom-ident';
import { tryConsumeAnPlusB, type AnPlusBValue } from '../values/an-plus-b';
import {
  bad, ComponentConsumerBadReason, isBad, isOk, ok, unwrapConsumeResultOrThrow,
  type TryComponentConsumer, type TryComponentConsumerResult,
} from './component-try-consumer';

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

export type SelectorParserContext = Readonly<{
  // Pseudo-element governing pseudo-class validity in this tail.
  pseudoClassTailElement?: PseudoElementName;

  // Origin against which the next sub-pseudo-element candidate is validated.
  subPseudoElementOrigin?: PseudoElementName;

  // Pseudo-element on the left side of the next potential combinator.
  combinatorLeftPseudoElement?: PseudoElementName;

  // Named namespace prefixes declared for this parse; absence means none are declared.
  declaredNamespacePrefixes?: ReadonlySet<string>;

  // Strongest selector grammar allowed by the enclosing selector argument.
  selectorRestriction?: SelectorRestriction;

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
    declaredNamespacePrefixes: context.declaredNamespacePrefixes,
    selectorRestriction: narrowSelectorRestriction(
      context.selectorRestriction,
      restriction,
    ),
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

/**
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

/**
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

/**
 * <selector-list> = <complex-selector-list>
 */
export type SelectorList = ComplexSelectorList;

export function parseSelectorList(
  input: ParserInput,
  context: SelectorParserContext = {},
): SelectorList | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(input, tryConsumeSelectorList, context),
    'selector list',
  );
}

function tryConsumeSelectorList(c: ComponentCursor): TryComponentConsumerResult<SelectorList> {
  return consumeSelectorList(c);
}

const consumeSelectorList: TryComponentConsumer<SelectorList> =
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
  input: ParserInput,
  context: SelectorParserContext = {},
): ComplexSelectorList | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(input, tryConsumeComplexSelectorList, context),
    'complex selector list',
  );
}

function tryConsumeComplexSelectorList(c: ComponentCursor): TryComponentConsumerResult<ComplexSelectorList> {
  const start = c.pos();
  const armsResult = consumeComplexSelectorListArms(c);

  if (armsResult === null) {
    c.restore(start);
    return null;
  }

  if (isBad(armsResult)) {
    c.restore(start);
    return null;
  }

  const arms = armsResult.value;

  return ok({
    kind: SelectorKind.ComplexSelectorList,
    arms,
    specificity: listSpecificity(arms),
  });
}

const consumeComplexSelectorListArms: TryComponentConsumer<ComplexSelector[]> =
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
  input: ParserInput,
  context: SelectorParserContext = {},
): ComplexRealSelectorList | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(input, tryConsumeComplexRealSelectorList, context),
    'complex real selector list',
  );
}

function tryConsumeComplexRealSelectorList(c: ComponentCursor): TryComponentConsumerResult<ComplexRealSelectorList> {
  const arms = unwrapConsumeResultOrThrow(consumeComplexRealSelectorListArms(c), 'complex real selector list arms');
  if (arms === null) return null;

  const res: ComplexRealSelectorList = {
    kind: SelectorKind.ComplexRealSelectorList,
    arms,
    specificity: listSpecificity(arms),
  };

  return ok(res);
}

const consumeComplexRealSelectorListArms: TryComponentConsumer<ComplexRealSelector[]> =
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
  input: ParserInput,
  context: SelectorParserContext = {},
): CompoundSelectorList | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(input, tryConsumeCompoundSelectorList, context),
    'compound selector list',
  );
}

function tryConsumeCompoundSelectorList(c: ComponentCursor): TryComponentConsumerResult<CompoundSelectorList> {
  const arms = unwrapConsumeResultOrThrow(
    consumeCompoundSelectorListArms(c),
    'compound selector list arms',
  );

  if (arms === null) return null;

  return ok({
    kind: SelectorKind.CompoundSelectorList,
    arms,
    specificity: listSpecificity(arms),
  });
}

const consumeCompoundSelectorListArms: TryComponentConsumer<CompoundSelector[]> =
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
  input: ParserInput,
  context: SelectorParserContext = {},
): SimpleSelectorList | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(input, tryConsumeSimpleSelectorList, context),
    'simple selector list',
  );
}

function tryConsumeSimpleSelectorList(c: ComponentCursor): TryComponentConsumerResult<SimpleSelectorList> {
  const arms = unwrapConsumeResultOrThrow(
    consumeSimpleSelectorListArms(c),
    'simple selector list arms',
  );

  if (arms === null) return null;

  return ok({
    kind: SelectorKind.SimpleSelectorList,
    arms,
    specificity: listSpecificity(arms),
  });
}

const consumeSimpleSelectorListArms: TryComponentConsumer<SimpleSelector[]> =
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
  input: ParserInput,
  context: SelectorParserContext = {},
): RelativeSelectorList | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(input, tryConsumeRelativeSelectorList, context),
    'relative selector list',
  );
}

function tryConsumeRelativeSelectorList(c: ComponentCursor): TryComponentConsumerResult<RelativeSelectorList> {
  const arms = unwrapConsumeResultOrThrow(
    consumeRelativeSelectorListArms(c),
    'relative selector list arms',
  );

  if (arms === null) return null;

  return ok({
    kind: SelectorKind.RelativeSelectorList,
    arms,
    specificity: listSpecificity(arms),
  });
}

const consumeRelativeSelectorListArms: TryComponentConsumer<RelativeSelector[]> =
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
  input: ParserInput,
  context: SelectorParserContext = {},
): RelativeRealSelectorList | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(input, tryConsumeRelativeRealSelectorList, context),
    'relative real selector list',
  );
}

function tryConsumeRelativeRealSelectorList(c: ComponentCursor): TryComponentConsumerResult<RelativeRealSelectorList> {
  const arms = unwrapConsumeResultOrThrow(
    consumeRelativeRealSelectorListArms(c),
    'relative real selector list arms',
  );

  if (arms === null) return null;

  return ok({
    kind: SelectorKind.RelativeRealSelectorList,
    arms,
    specificity: listSpecificity(arms),
  });
}

const consumeRelativeRealSelectorListArms: TryComponentConsumer<RelativeRealSelector[]> =
  commaRepeat(tryConsumeRelativeRealSelector);

/**
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
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(input, tryConsumeComplexSelector, context),
    'complex selector',
  );
}

function tryConsumeComplexSelector(c: ComponentCursor): TryComponentConsumerResult<ComplexSelector> {
  return consumeComplexSelector(c);
}

const consumeComplexSelector: TryComponentConsumer<ComplexSelector> = sequenceOf(
  [
    one(tryConsumeComplexSelectorUnit, {
      contextAfter: (unit, context) =>
        contextAfterComplexSelectorUnit(context as SelectorParserContext, unit),
    }),

    any(
      sequenceOf(
        [
          one(tryConsumeCombinator),
          one(tryConsumeComplexSelectorUnit),
        ],

        ([[combinator], [unit]]) => ok({
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

  ([[head], tail]) => ok({
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

function tryConsumeComplexSelectorUnit(c: ComponentCursor): TryComponentConsumerResult<ComplexSelectorUnit> {
  return consumeComplexSelectorUnit(c);
}

const consumeComplexSelectorUnit: TryComponentConsumer<ComplexSelectorUnit> =
  requiredSequenceOf(
    [
      opt(tryConsumeCompoundSelector),

      any(tryConsumePseudoCompoundSelector, {
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

    ([[compound], pseudoCompounds]) => ok({
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
  input: ParserInput,
  context: SelectorParserContext = {},
): ComplexRealSelector | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(input, tryConsumeComplexRealSelector, context),
    'complex real selector',
  );
}

function tryConsumeComplexRealSelector(c: ComponentCursor): TryComponentConsumerResult<ComplexRealSelector> {
  return consumeComplexRealSelector(c);
}

const consumeComplexRealSelector: TryComponentConsumer<ComplexRealSelector> = sequenceOf(
  [
    one(tryConsumeCompoundSelector),

    any(
      sequenceOf(
        [
          one(tryConsumeCombinator),
          one(tryConsumeCompoundSelector),
        ],

        ([[combinator], [compound]]) => ok({
          combinator,
          compound,
        }),
      ),
    ),
  ],

  ([[head], tail]) => ok({
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

function tryConsumeRelativeSelector(c: ComponentCursor): TryComponentConsumerResult<RelativeSelector> {
  return consumeRelativeSelector(c);
}

const consumeRelativeSelector: TryComponentConsumer<RelativeSelector> = sequenceOf(
  [
    opt(tryConsumeCombinator),
    one(tryConsumeComplexSelector),
  ],

  ([combinator, [selector]]) => ok({
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

function tryConsumeRelativeRealSelector(c: ComponentCursor): TryComponentConsumerResult<RelativeRealSelector> {
  return consumeRelativeRealSelector(c);
}

const consumeRelativeRealSelector: TryComponentConsumer<RelativeRealSelector> = sequenceOf(
  [
    opt(tryConsumeCombinator),
    one(tryConsumeComplexRealSelector),
  ],

  ([combinator, [selector]]) => ok({
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
  input: ParserInput,
  context: SelectorParserContext = {},
): CompoundSelector | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(input, tryConsumeCompoundSelector, context),
    'compound selector',
  );
}

function tryConsumeCompoundSelector(c: ComponentCursor): TryComponentConsumerResult<CompoundSelector> {
  return consumeCompoundSelector(c);
}

const consumeCompoundSelector: TryComponentConsumer<CompoundSelector> = requiredSequenceOf(
  [
    opt(tryConsumeTypeSelector),
    any(tryConsumeSubclassSelector),
  ],

  ([[typeSelector], subclasses]) => ok({
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

function tryConsumePseudoCompoundSelector(
  c: ComponentCursor,
): TryComponentConsumerResult<PseudoCompoundSelector> {
  const start = c.pos();
  const result = consumePseudoCompoundSelector(c);

  if (result === null || isBad(result)) {
    return result;
  }

  const context = c.context as SelectorParserContext;
  const pseudoElement = canonicalPseudoElementName(result.value.pseudoElement.name);

  if (
    pseudoElement === null ||
    !isValidSubPseudoElement(context.subPseudoElementOrigin, pseudoElement)
  ) {
    c.restore(start);
    return null;
  }

  return result;
}

const consumePseudoCompoundSelector: TryComponentConsumer<PseudoCompoundSelector> = sequenceOf(
  [
    one(tryConsumePseudoElementSelector, {
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
    any(tryConsumePseudoClassSelector),
  ],

  ([[pseudoElement], pseudoClasses]) => ok({
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
  input: ParserInput,
  context: SelectorParserContext = {},
): SimpleSelector | null {
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(input, tryConsumeSimpleSelector, context),
    'simple selector',
  );
}

function tryConsumeSimpleSelector(c: ComponentCursor): TryComponentConsumerResult<SimpleSelector> {
  return consumeSimpleSelector(c);
}

const consumeSimpleSelector: TryComponentConsumer<SimpleSelector> = oneOf(
  [
    one(tryConsumeTypeSelector),
    one(tryConsumeSubclassSelector),
  ],

  ([selector]) => ok(selector),
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

function tryConsumeCombinator(c: ComponentCursor): TryComponentConsumerResult<Combinator> {
  const start = c.pos();
  const result = consumeCombinator(c);

  if (result === null || isBad(result)) {
    return result;
  }

  const context = c.context as SelectorParserContext;
  const pseudoElement = context.combinatorLeftPseudoElement;

  if (
    pseudoElement !== undefined &&
    !isValidCombinatorAfterPseudoElement(pseudoElement, result.value)
  ) {
    c.restore(start);
    return null;
  }

  return result;
}

const consumeCombinator: TryComponentConsumer<Combinator> = (c) => {
  const start = c.pos();

  const sawWhitespace = c.match(TokenKind.Whitespace);
  const afterWhitespace = c.pos();

  const first = c.next();

  if (isDelimToken(first, '>')) {
    consumeComponentTrivia(c);
    return ok('>');
  }

  if (isDelimToken(first, '+')) {
    consumeComponentTrivia(c);
    return ok('+');
  }

  if (isDelimToken(first, '~')) {
    consumeComponentTrivia(c);
    return ok('~');
  }

  if (isDelimToken(first, '|')) {
    const second = c.next();

    if (isDelimToken(second, '|')) {
      consumeComponentTrivia(c);
      return ok('||');
    }
  }

  if (sawWhitespace) {
    c.restore(afterWhitespace);
    return ok(' ');
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

function tryConsumeWqName(c: ComponentCursor): TryComponentConsumerResult<WqName> {
  return consumeWqName(c);
}

const consumeWqName: TryComponentConsumer<WqName> = sequenceOf(
  [
    opt(tryConsumeNsPrefix),
    one(tryConsumeIdentToken),
  ],

  ([namespace, [name]]) => ok({
    namespace: namespace[0] ?? null,
    name: name.value,
  }),
);

/**
 * <ns-prefix> = [ <ident-token> | '*' ]? '|'
 */
function tryConsumeNsPrefix(c: ComponentCursor): TryComponentConsumerResult<string> {
  const start = c.pos();
  const result = consumeNsPrefix(c);

  if (result === null || isBad(result)) {
    return result;
  }

  const prefix = result.value;

  if (prefix === '' || prefix === '*') {
    return result;
  }

  const context = c.context as SelectorParserContext;

  if (context.declaredNamespacePrefixes?.has(prefix) !== true) {
    c.restore(start);
    return null;
  }

  return result;
}

const tryConsumeStarDelim = createDelimConsumer('*');
const tryConsumePipeDelim = createDelimConsumer('|');

const consumeNsPrefix: TryComponentConsumer<string> = sequenceOf(
  [
    opt(
      oneOf(
        [
          one(tryConsumeIdentToken),
          one(tryConsumeStarDelim),
        ],
        ([prefix]) => ok(
          typeof prefix === 'string'
            ? prefix
            : prefix.value,
        ),
      ),
    ),
    one(tryConsumePipeDelim),
  ],

  ([prefix]) => ok(prefix[0] ?? ''),
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

function tryConsumeTypeSelector(c: ComponentCursor): TryComponentConsumerResult<TypeSelector> {
  const ctx = c.context as SelectorParserContext;

  if (ctx.pseudoClassTailElement !== undefined) {
    return null;
  }

  return consumeTypeSelector(c);
}

const consumeTypeSelector: TryComponentConsumer<TypeSelector> = sequenceOf(
  [
    opt(tryConsumeNsPrefix),

    one(
      oneOf(
        [
          one(tryConsumeIdentToken),
          one(tryConsumeStarDelim),
        ],

        ([name]) => ok(
          typeof name === 'string'
            ? name
            : name.value,
        ),
      ),
    ),
  ],

  ([namespace, [name]]) => ok({
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

function tryConsumeSubclassSelector(c: ComponentCursor): TryComponentConsumerResult<SubclassSelector> {
  return consumeSubclassSelector(c);
}

const consumeSubclassSelector: TryComponentConsumer<SubclassSelector> = oneOf(
  [
    one(tryConsumeIdSelector),
    one(tryConsumeClassSelector),
    one(tryConsumeAttributeSelector),
    one(tryConsumePseudoClassSelector),
  ],
  ([selector]) => ok(selector),
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

function tryConsumeIdSelector(c: ComponentCursor): TryComponentConsumerResult<IdSelector> {
  const ctx = c.context as SelectorParserContext;

  if (ctx.pseudoClassTailElement !== undefined) {
    return null;
  }

  return consumeIdSelector(c);
}

const consumeIdSelector: TryComponentConsumer<IdSelector> = sequenceOf(
  [
    one(tryConsumeIdHashToken),
  ],

  ([[hash]]) => ok({
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

function tryConsumeClassSelector(c: ComponentCursor): TryComponentConsumerResult<ClassSelector> {
  const ctx = c.context as SelectorParserContext;

  if (ctx.pseudoClassTailElement !== undefined) {
    return null;
  }

  return consumeClassSelector(c);
}

const tryConsumeDotDelim = createDelimConsumer('.');

const consumeClassSelector: TryComponentConsumer<ClassSelector> = sequenceOf(
  [
    one(tryConsumeDotDelim),
    one(tryConsumeIdentToken),
  ],

  ([, [ident]]) => ok({
    kind: SelectorKind.ClassSelector,
    name: ident.value,
    specificity: SpecificityB,
  }),
);

/**
 * <attribute-selector> =
 *   '[' <wq-name> ']' |
 *   '[' <wq-name> <attr-matcher>
 *       [ <string-token> | <ident-token> ] <attr-modifier>? ']'
 *
 * Component-value tokenization represents the brackets and their contents as
 * one bracket block. consumeAttributeSelector unwraps that block, and
 * consumeAttributeSelectorBody parses the grammar between the brackets.
 */
export type AttributeSelector = {
  kind: SelectorKind.AttributeSelector;
  name: WqName;
  matcher: AttrMatcher | null;
  value: string | null;
  modifier: AttrModifier | null;
  specificity: Specificity;
};

function tryConsumeAttributeSelector(c: ComponentCursor): TryComponentConsumerResult<AttributeSelector> {
  const ctx = c.context as SelectorParserContext;

  if (ctx.pseudoClassTailElement !== undefined) {
    return null;
  }

  return consumeAttributeSelector(c);
}

const consumeAttributeSelectorBody: TryComponentConsumer<AttributeSelector> = oneOf(
  [
    one(
      sequenceOf(
        [
          one(withComponentTrivia(tryConsumeWqName)),
          one(withComponentTrivia(tryConsumeAttrMatcher)),
          one(withComponentTrivia(tryConsumeAttrValue)),
          opt(withComponentTrivia(tryConsumeAttrModifier)),
        ],

        ([[name], [matcher], [value], modifier]) => {
          const res: AttributeSelector = {
            kind: SelectorKind.AttributeSelector,
            name,
            matcher,
            value,
            modifier: modifier[0] ?? null,
            specificity: SpecificityB,
          };
          return ok(res);
        },
      ),
    ),
    one(
      sequenceOf(
        [
          one(withComponentTrivia(tryConsumeWqName)),
        ],
        ([[name]]) => {
          const res: AttributeSelector = {
            kind: SelectorKind.AttributeSelector,
            name,
            matcher: null,
            value: null,
            modifier: null,
            specificity: SpecificityB,
          };
          return ok(res);
        }
      ),
    ),
  ],

  ([selector]) => ok(selector),
);

const consumeAttributeSelector: TryComponentConsumer<AttributeSelector> = (c) => {
  const start = c.pos();
  const block = c.next();

  if (!isBracketBlock(block)) {
    c.restore(start);
    return null;
  }

  const selector = unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(block.value, consumeAttributeSelectorBody, c.context),
    'attribute selector body',
  );

  if (selector === null) {
    c.restore(start);
    return null;
  }

  return ok(selector);
};

/**
 * <attr-matcher> = [ '~' | '|' | '^' | '$' | '*' ]? '='
 */
export type AttrMatcher = '=' | '~=' | '|=' | '^=' | '$=' | '*=';

function tryConsumeAttrMatcher(c: ComponentCursor): TryComponentConsumerResult<AttrMatcher> {
  return consumeAttrMatcher(c);
}

const consumeAttrMatcher: TryComponentConsumer<AttrMatcher> = (c) => {
  const start = c.pos();
  const first = c.next();

  if (isDelimToken(first, '=')) {
    return ok('=');
  }

  let prefix: '~' | '|' | '^' | '$' | '*' | null = null;

  if (isDelimToken(first, '~')) prefix = '~';
  else if (isDelimToken(first, '|')) prefix = '|';
  else if (isDelimToken(first, '^')) prefix = '^';
  else if (isDelimToken(first, '$')) prefix = '$';
  else if (isDelimToken(first, '*')) prefix = '*';

  if (prefix !== null && isDelimToken(c.next(), '=')) {
    const res: AttrMatcher = `${prefix}=`;
    return ok(res);
  }

  c.restore(start);
  return null;
};

/**
 * <attr-value> = [ <string-token> | <ident-token> ]
 */
function tryConsumeAttrValue(c: ComponentCursor): TryComponentConsumerResult<string> {
  return consumeAttrValue(c);
}

const consumeAttrValue: TryComponentConsumer<string> = oneOf(
  [
    one(tryConsumeStringToken),
    one(tryConsumeIdentToken),
  ],
  ([token]) => ok(token.value),
);

/**
 * <attr-modifier> = i | s
 */
export type AttrModifier = 'i' | 's';

function tryConsumeAttrModifier(c: ComponentCursor): TryComponentConsumerResult<AttrModifier> {
  return consumeAttrModifier(c);
}

const consumeAttrModifier: TryComponentConsumer<AttrModifier> = (c) => {
  const start = c.pos();

  const ident = unwrapConsumeResultOrThrow(
    tryConsumeIdentToken(c),
    'attribute modifier ident',
  );

  if (ident === null) {
    return null;
  }

  const value = asciiLower(ident.value);

  if (value === 'i' || value === 's') {
    return ok(value);
  }

  c.restore(start);
  return null;
};

/**
 * <pseudo-class-selector> =
 *   : <ident-token> |
 *   : <function-token> <any-value> )
 *
 * Representing functional notation using the parser's component-value
 * <function-block> gives the equivalent execution grammar:
 *
 *   <pseudo-class-selector> =
 *     : <ident-token> |
 *     : <function-block>
 */
export type PseudoClassSelector = {
  kind: SelectorKind.PseudoClassSelector;
  name: string;
  argument: PseudoArgument | null;
  specificity: Specificity;
};

function tryConsumePseudoClassSelector(c: ComponentCursor): TryComponentConsumerResult<PseudoClassSelector> {
  return consumePseudoClassSelector(c);
}

const consumePseudoClassSelector: TryComponentConsumer<PseudoClassSelector> = oneOf(
  [
    one(
      sequenceOf(
        [
          one(tryConsumeColon),
          one(tryConsumeIdentToken),
        ],
        ([, [ident]], ctx) =>
          createPseudoClassSelector(ident.value, null, ctx as SelectorParserContext),
      ),
    ),
    one(
      sequenceOf(
        [
          one(tryConsumeColon),
          one(tryConsumeFunctionBlock),
        ],
        ([, [fn]], ctx) =>
          createPseudoClassSelector(fn.name, fn.value, ctx as SelectorParserContext),
      ),
    ),
  ],
  ([selector]) => ok(selector),
);

/**
 * <pseudo-element-selector> =
 *   : <pseudo-class-selector> | <legacy-pseudo-element-selector>
 *
 * Expanding <pseudo-class-selector>, and representing functional notation
 * using the parser's component-value <function-block>, gives:
 *
 *   <pseudo-element-selector> =
 *     <legacy-pseudo-element-selector> |
 *     : : <ident-token> |
 *     : : <function-block>
 */
export type PseudoElementSelector = {
  kind: SelectorKind.PseudoElementSelector;
  name: string;
  argument: PseudoArgument | null;
  specificity: Specificity;
};

function tryConsumePseudoElementSelector(c: ComponentCursor): TryComponentConsumerResult<PseudoElementSelector> {
  return consumePseudoElementSelector(c);
}

const consumePseudoElementSelector: TryComponentConsumer<PseudoElementSelector> = oneOf(
  [
    one(
      sequenceOf(
        [
          one(tryConsumeLegacyPseudoElementName),
        ],
        ([[name]], ctx) =>
          createPseudoElementSelector(name, null, true, ctx as SelectorParserContext),
      ),
    ),
    one(
      sequenceOf(
        [
          one(tryConsumeColon),
          one(tryConsumeColon),
          one(tryConsumeIdentToken),
        ],
        ([, , [ident]], ctx) =>
          createPseudoElementSelector(ident.value, null, false, ctx as SelectorParserContext),
      ),
    ),
    one(
      sequenceOf(
        [
          one(tryConsumeColon),
          one(tryConsumeColon),
          one(tryConsumeFunctionBlock),
        ],
        ([, , [fn]], ctx) =>
          createPseudoElementSelector(fn.name, fn.value, false, ctx as SelectorParserContext),
      ),
    ),
  ],
  ([selector]) => ok(selector),
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

function tryConsumeLegacyPseudoElementName(c: ComponentCursor): TryComponentConsumerResult<LegacyPseudoElementName> {
  return consumeLegacyPseudoElementName(c);
}

const consumeLegacyPseudoElementName: TryComponentConsumer<LegacyPseudoElementName> = (c) => {
  const start = c.pos();

  const colon = unwrapConsumeResultOrThrow(
    tryConsumeColon(c),
    'legacy pseudo-element colon',
  );

  if (colon === null) {
    return null;
  }

  const ident = unwrapConsumeResultOrThrow(
    tryConsumeIdentToken(c),
    'legacy pseudo-element name',
  );

  if (ident === null) {
    c.restore(start);
    return null;
  }

  const name = asciiLower(ident.value);

  if (!isLegacyPseudoElementName(name)) {
    c.restore(start);
    return null;
  }

  return ok(name);
};

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
): TryComponentConsumerResult<PseudoClassSelector> {
  const name = canonicalPseudoClassName(rawName);

  if (name === null) {
    return null;
  }

  const pseudoElement = context.pseudoClassTailElement;

  if (
    pseudoElement !== undefined &&
    !isValidPseudoClassAfterPseudoElement(pseudoElement, name)
  ) {
    return bad(
      ComponentConsumerBadReason.Invalid,
      `Pseudo-class :${name} is not valid after ::${pseudoElement}`,
    );
  }

  switch (name) {
    // Logical combination pseudo-classes

    case 'is': {
      if (value === null) return null;

      const argument = parseForgivingSelectorListArgument(value, context);

      return ok({
        kind: SelectorKind.PseudoClassSelector,
        name,
        argument,
        specificity: argument.selectors.specificity,
      });
    }

    case 'where': {
      if (value === null) return null;

      const argument = parseForgivingSelectorListArgument(value, context);

      return ok({
        kind: SelectorKind.PseudoClassSelector,
        name,
        argument,
        specificity: Specificity0,
      });
    }

    case 'not': {
      if (value === null) return null;

      const selectors = parseStrictComplexRealSelectorListArgument(value, context);

      if (selectors === null || isBad(selectors)) {
        return selectors;
      }

      const argument: ComplexRealSelectorListPseudoArgument = {
        kind: PseudoArgumentKind.ComplexRealSelectorList,
        selectors: selectors.value,
      };

      return ok({
        kind: SelectorKind.PseudoClassSelector,
        name,
        argument,
        specificity: argument.selectors.specificity,
      });
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

      return ok({
        kind: SelectorKind.PseudoClassSelector,
        name,
        argument,
        specificity: argument.selectors.specificity,
      });
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
        return ok({
          kind: SelectorKind.PseudoClassSelector,
          name,
          argument: null,
          specificity: SpecificityB,
        });
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

      return ok({
        kind: SelectorKind.PseudoClassSelector,
        name,
        argument,
        specificity: addSpecificity(
          SpecificityB,
          argument.selector.specificity,
        ),
      });
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

      return ok({
        kind: SelectorKind.PseudoClassSelector,
        name,
        argument,
        specificity: addSpecificity(
          SpecificityB,
          argument.selector.specificity,
        ),
      });
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
): TryComponentConsumerResult<PseudoClassSelector> {
  if (value !== null) {
    return null;
  }

  return ok({
    kind: SelectorKind.PseudoClassSelector,
    name,
    argument: null,
    specificity,
  });
}

function createArgumentPseudoClassSelector<T extends PseudoArgument>(
  name: PseudoClassName,
  value: readonly ComponentValue[] | null,
  context: SelectorParserContext,
  parseArgument: PseudoArgumentParser<T>,
  specificity: Specificity | ((argument: T) => Specificity) = SpecificityB,
): TryComponentConsumerResult<PseudoClassSelector> {
  if (value === null) return null;

  const argument = parseArgument(value, context);
  if (argument === null) return null;

  return ok({
    kind: SelectorKind.PseudoClassSelector,
    name,
    argument,
    specificity: typeof specificity === 'function'
      ? specificity(argument)
      : specificity,
  });
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
): TryComponentConsumerResult<PseudoElementSelector> {
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
    // Placement is validated by tryConsumePseudoCompoundSelector.

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

      return ok({
        kind: SelectorKind.PseudoElementSelector,
        name,
        argument,
        specificity: SpecificityC,
      });
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

      return ok({
        kind: SelectorKind.PseudoElementSelector,
        name,
        argument,
        specificity: addSpecificity(
          SpecificityC,
          argument.selector.specificity,
        ),
      });
    }

    case 'part': {
      if (legacy || value === null) {
        return null;
      }

      const argument = parsePartNameListArgument(value, context);

      if (argument === null) {
        return null;
      }

      return ok({
        kind: SelectorKind.PseudoElementSelector,
        name,
        argument,
        specificity: SpecificityC,
      });
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
): TryComponentConsumerResult<PseudoElementSelector> {
  if (value !== null) {
    return null;
  }

  // Defensive only. The parser already restricts legacy names before this.
  if (legacy && !isLegacyPseudoElementName(name)) {
    return null;
  }

  return ok({
    kind: SelectorKind.PseudoElementSelector,
    name,
    argument: null,
    specificity,
  });
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

  const parsed = parseListAsComponentGrammar(
    arg,
    withComponentTrivia(parseSelector),
    argumentContext,
  );

  const arms = parsed
    .filter(isOk)
    .map((result) => result.value);

  return {
    kind: PseudoArgumentKind.ForgivingSelectorList,
    selectors: {
      kind: SelectorKind.ComplexRealSelectorList,
      arms,
      specificity: listSpecificity(arms),
    },
  };
}

function parseStrictComplexRealSelectorListArgument(
  arg: readonly ComponentValue[],
  context: SelectorParserContext,
): TryComponentConsumerResult<ComplexRealSelectorList> {
  const argumentContext = contextForSelectorArgument(context);
  const parseSelector = parserForSelectorRestriction(argumentContext);

  const parsed = parseListAsComponentGrammar(
    arg,
    withComponentTrivia(parseSelector),
    argumentContext,
  );

  const arms: ComplexRealSelector[] = [];

  for (const result of parsed) {
    if (isBad(result)) {
      return result;
    }

    if (result === null) {
      return context.pseudoClassTailElement === undefined
        ? null
        : bad(
          ComponentConsumerBadReason.Invalid,
          `Selector is not valid after ::${context.pseudoClassTailElement}`,
        );
    }

    arms.push(result.value);
  }

  if (arms.length === 0) {
    return null;
  }

  return ok({
    kind: SelectorKind.ComplexRealSelectorList,
    arms,
    specificity: listSpecificity(arms),
  });
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
): TryComponentConsumer<ComplexRealSelector> {
  switch (context.selectorRestriction) {
    case 'simple':
      return tryConsumeSimpleAsComplexRealSelector;
    case 'compound':
      return tryConsumeCompoundAsComplexRealSelector;
    case 'complex-real':
    case undefined:
      return tryConsumeComplexRealSelector;
  }
}

const tryConsumeCompoundAsComplexRealSelector: TryComponentConsumer<ComplexRealSelector> = (c) => {
  const result = tryConsumeCompoundSelector(c);

  if (result === null || isBad(result)) {
    return result;
  }

  return ok({
    kind: SelectorKind.ComplexRealSelector,
    parts: [
      {
        combinator: null,
        compound: result.value,
      },
    ],
    specificity: result.value.specificity,
  });
};

const tryConsumeSimpleAsComplexRealSelector: TryComponentConsumer<ComplexRealSelector> = (c) => {
  const result = tryConsumeSimpleSelector(c);

  if (result === null || isBad(result)) {
    return result;
  }

  const selector = result.value;
  const compound: CompoundSelector = {
    kind: SelectorKind.CompoundSelector,
    typeSelector: selector.kind === SelectorKind.TypeSelector ? selector : null,
    subclasses: selector.kind === SelectorKind.TypeSelector ? [] : [selector],
    specificity: selector.specificity,
  };

  return ok({
    kind: SelectorKind.ComplexRealSelector,
    parts: [{ combinator: null, compound }],
    specificity: compound.specificity,
  });
};

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
  const anb = unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(value, withComponentTrivia(tryConsumeAnPlusB), context),
    'An+B argument',
  );

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
  return unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(value, tryConsumeNthChildArgument, context),
    'nth-child argument',
  );
}

function tryConsumeNthChildArgument(c: ComponentCursor): TryComponentConsumerResult<NthChildPseudoArgument> {
  const start = c.pos();

  const anb = unwrapConsumeResultOrThrow(
    withComponentTrivia(tryConsumeAnPlusB)(c),
    'nth-child An+B',
  );

  if (anb === null) {
    c.restore(start);
    return null;
  }

  const of = unwrapConsumeResultOrThrow(
    tryConsumeNthChildOfClause(c),
    'nth-child of clause',
  );

  return ok({
    kind: PseudoArgumentKind.NthChild,
    formula: anb,
    of,
  });
}

const tryConsumeOfIdent = createIdentValueConsumer('of');

function tryConsumeNthChildOfClause(c: ComponentCursor): TryComponentConsumerResult<ComplexRealSelectorList | null> {
  const start = c.pos();

  const of = unwrapConsumeResultOrThrow(
    withComponentTrivia(tryConsumeOfIdent)(c),
    'nth-child of ident',
  );

  if (of === null) {
    c.restore(start);
    return ok(null);
  }

  const selectors = unwrapConsumeResultOrThrow(
    tryConsumeNthChildOfSelectorList(c),
    'nth-child of selector list',
  );

  if (selectors === null) {
    c.restore(start);
    return ok(null);
  }

  return ok(selectors);
}

function tryConsumeNthChildOfSelectorList(
  c: ComponentCursor,
): TryComponentConsumerResult<ComplexRealSelectorList> {
  const outerContext = c.context as SelectorParserContext;
  const argumentContext = contextForSelectorArgument(outerContext);

  try {
    c.context = argumentContext;

    const consumeArms = commaRepeat(parserForSelectorRestriction(argumentContext));
    const arms = unwrapConsumeResultOrThrow(
      withComponentTrivia(consumeArms)(c),
      'restricted nth-child of selector list arms',
    );

    if (arms === null) {
      return null;
    }

    return ok({
      kind: SelectorKind.ComplexRealSelectorList,
      arms,
      specificity: listSpecificity(arms),
    });
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
  const ident = unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(value, withComponentTrivia(tryConsumeIdentToken), context),
    'ident argument',
  );

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
  const integer = unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(value, withComponentTrivia(tryConsumeInteger), context),
    'integer argument',
  );

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
  const parsed = parseListAsComponentGrammar(
    value,
    withComponentTrivia(tryConsumeInteger),
    context,
  );
  const values: number[] = [];

  for (const result of parsed) {
    const integer = unwrapConsumeResultOrThrow(result, 'integer list item');

    if (integer === null) {
      return null;
    }

    values.push(integer);
  }

  if (values.length === 0) {
    return null;
  }

  return {
    kind: PseudoArgumentKind.IntegerList,
    values,
  };
}

function tryConsumeInteger(c: ComponentCursor): TryComponentConsumerResult<number> {
  const token = unwrapConsumeResultOrThrow(
    tryConsumeIntegerToken(c),
    'integer token',
  );
  return token === null ? null : ok(token.value);
}

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
  const parsed = parseListAsComponentGrammar(
    value,
    withComponentTrivia(tryConsumeLanguageRange),
    context,
  );

  const ranges: LanguageRange[] = [];

  for (const result of parsed) {
    const range = unwrapConsumeResultOrThrow(result, 'language range');

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

function tryConsumeLanguageRange(c: ComponentCursor): TryComponentConsumerResult<LanguageRange> {
  const start = c.pos();
  const component = c.next();

  if (isIdentToken(component)) {
    return ok(component.value);
  }

  if (isTokenKind(component, TokenKind.String)) {
    return ok(component.value);
  }

  c.restore(start);
  return null;
}

// --------------------------------------
// Direction arguments
// --------------------------------------

type DirectionPseudoArgument = {
  kind: PseudoArgumentKind.Direction;
  value: 'ltr' | 'rtl' | null;
};

function parseDirectionArgument(
  value: readonly ComponentValue[],
  context: SelectorParserContext,
): DirectionPseudoArgument | null {
  const raw = unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(value, withComponentTrivia(tryConsumeDirectionIdent), context),
    'direction argument',
  );

  if (raw === null) {
    return null;
  }

  return {
    kind: PseudoArgumentKind.Direction,
    value: raw === 'ltr' || raw === 'rtl' ? raw : null,
  };
}

function tryConsumeDirectionIdent(c: ComponentCursor): TryComponentConsumerResult<string> {
  const start = c.pos();
  const ident = c.next();

  if (!isIdentToken(ident)) {
    c.restore(start);
    return null;
  }

  return ok(asciiLower(ident.value));
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
  const names = unwrapConsumeResultOrThrow(
    parseAsComponentGrammar(value, tryConsumePartNameList, context),
    'part name list',
  );

  if (names === null) {
    return null;
  }

  return {
    kind: PseudoArgumentKind.PartNameList,
    names,
  };
}

/**
 * <part-name-list> = <ident-token>+
 */
function tryConsumePartNameList(c: ComponentCursor): TryComponentConsumerResult<string[]> {
  return consumePartNameList(c);
}

const consumePartNameList: TryComponentConsumer<string[]> = plus(
  withComponentTrivia((c): TryComponentConsumerResult<string> => {
    const ident = unwrapConsumeResultOrThrow(
      tryConsumeIdentToken(c),
      'part name',
    );

    if (ident === null) {
      return null;
    }

    return ok(ident.value);
  }),
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
