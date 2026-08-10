import { asciiLower } from '../../shared/css';
import {
  consumeColon, consumeEqualsDelim, consumeGreaterDelim, consumeIdentToken,
  consumeLessDelim, consumeParensBlock,
} from '../syntax/component-consumers';
import {
  adaptConsumer, any, one, oneOf, opt, plus, sequenceOf, withTrivia,
} from '../syntax/component-grammar';
import {
  serializeCssIdentifier, type ParensBlock,
} from '../syntax/component-value';
import {
  createComponentParser, parseAsComponentGrammar, parseListAsComponentGrammar,
  type ParserInput,
} from '../syntax/parser';
import {
  type TokenCursor, type TryConsumer, type TryConsumerResult,
} from '../syntax/token-cursor';
import type { ValueStage } from '../value-processing/stage';
import {
  consumeDimension, resolveDimension, serializeDimension, type DimensionValue,
} from './dimension';
import {
  consumeGeneralEnclosed, resolveGeneralEnclosed, serializeGeneralEnclosed,
  type GeneralEnclosedValue,
} from './general-enclosed';
import {
  consumeIdent, resolveIdent, serializeIdent, type IdentValue,
} from './ident';
import { createKeywordConsumer } from './keyword';
import { type MathContext } from './math-value';
import {
  consumeNumberOrRatio, resolveNumberOrRatio, serializeNumberOrRatio,
  type NumberOrRatioValue,
} from './ratio';

export type MediaQuery =
  | MediaConditionQuery
  | MediaTypeQuery;

type MediaConditionQuery = {
  type: 'media-condition-query';
  condition: MediaCondition;
};

type MediaTypeQuery = {
  type: 'media-type-query';
  modifier?: 'not' | 'only';
  mediaType: string;
  condition?: MediaConditionWithoutOr;
};

type MediaCondition =
  | MediaConditionWithoutOr
  | MediaOr;

type MediaConditionWithoutOr =
  | MediaInParens
  | MediaNot
  | MediaAnd;

type MediaInParens =
  | MediaConditionBlock
  | MediaFeatureBlock
  | GeneralEnclosedValue;

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
interface MediaConditionBlock extends ParensBlock<MediaCondition> {
  value: MediaCondition;
}

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
interface MediaFeatureBlock extends ParensBlock<MediaFeature> {
  value: MediaFeature;
}

type MediaNot = {
  type: 'media-not';
  value: MediaInParens;
};

type MediaAnd = {
  type: 'media-and';
  values: MediaConditionOperands;
};

type MediaOr = {
  type: 'media-or';
  values: MediaConditionOperands;
};

type MediaConditionOperands = [
  MediaInParens,
  MediaInParens,
  ...MediaInParens[],
];

type MediaFeature =
  | MediaFeaturePlain
  | MediaFeatureBoolean
  | MediaFeatureRange;

type MediaFeaturePlain = {
  type: 'media-feature-plain';
  name: string;
  value: MediaFeatureValue;
};

type MediaFeatureBoolean = {
  type: 'media-feature-boolean';
  name: string;
};

type MediaFeatureRange = {
  type: 'media-feature-range';
  name: string;
  left?: {
    comparison: MediaFeatureComparison;
    value: MediaFeatureValue;
  };
  right?: {
    comparison: MediaFeatureComparison;
    value: MediaFeatureValue;
  };
};

type MediaFeatureValue =
  | NumberOrRatioValue
  | DimensionValue
  | IdentValue;

type MediaFeatureComparison = '<' | '<=' | '>' | '>=' | '=';

export function parseMediaQuery(
  input: ParserInput,
  context: unknown = undefined,
): MediaQuery | null {
  return mediaQueryParser(input, context);
}

export function parseMediaQueryList(
  input: ParserInput,
  context: unknown = undefined,
): MediaQuery[] {
  return parseListAsComponentGrammar(input, withTrivia(mediaQueryConsumer), context)
    .map((query) => query ?? invalidMediaQuery());
}

export function consumeMediaQuery(
  c: TokenCursor,
): TryConsumerResult<MediaQuery> {
  return mediaQueryConsumer(c);
}

export function resolveMediaQuery(
  query: MediaQuery,
  stage: ValueStage,
  context: MathContext = {},
): MediaQuery {
  if (query.type === 'media-condition-query') {
    return {
      ...query,
      condition: resolveMediaCondition(query.condition, stage, context),
    };
  }

  return {
    ...query,
    ...(query.condition === undefined
      ? {}
      : { condition: resolveMediaConditionWithoutOr(query.condition, stage, context) }),
  };
}

export function resolveMediaQueryList(
  queries: readonly MediaQuery[],
  stage: ValueStage,
  context: MathContext = {},
): MediaQuery[] {
  return queries.map((query) => resolveMediaQuery(query, stage, context));
}

export function serializeMediaQuery(query: MediaQuery): string {
  if (query.type === 'media-condition-query') {
    return serializeMediaCondition(query.condition);
  }

  const mediaType = serializeCssIdentifier(query.mediaType);
  const head = query.modifier === undefined
    ? mediaType
    : `${query.modifier} ${mediaType}`;

  if (query.condition === undefined) return head;

  const condition = serializeMediaCondition(query.condition);
  return query.modifier === undefined && query.mediaType === 'all'
    ? condition
    : `${head} and ${condition}`;
}

export function serializeMediaQueryList(
  queries: readonly MediaQuery[],
): string {
  return queries.map(serializeMediaQuery).join(', ');
}

function resolveMediaCondition(
  condition: MediaCondition,
  stage: ValueStage,
  context: MathContext,
): MediaCondition {
  switch (condition.type) {
    case 'media-not':
      return {
        ...condition,
        value: resolveMediaInParens(condition.value, stage, context),
      };

    case 'media-and':
    case 'media-or':
      return {
        ...condition,
        values: resolveMediaConditionOperands(condition.values, stage, context),
      };

    default:
      return resolveMediaInParens(condition, stage, context);
  }
}

function resolveMediaConditionWithoutOr(
  condition: MediaConditionWithoutOr,
  stage: ValueStage,
  context: MathContext,
): MediaConditionWithoutOr {
  switch (condition.type) {
    case 'media-not':
      return {
        ...condition,
        value: resolveMediaInParens(condition.value, stage, context),
      };

    case 'media-and':
      return {
        ...condition,
        values: resolveMediaConditionOperands(condition.values, stage, context),
      };

    default:
      return resolveMediaInParens(condition, stage, context);
  }
}

function resolveMediaConditionOperands(
  values: MediaConditionOperands,
  stage: ValueStage,
  context: MathContext,
): MediaConditionOperands {
  const [first, second, ...rest] = values;
  return [
    resolveMediaInParens(first, stage, context),
    resolveMediaInParens(second, stage, context),
    ...rest.map((value) => resolveMediaInParens(value, stage, context)),
  ];
}

function resolveMediaInParens(
  value: MediaInParens,
  stage: ValueStage,
  context: MathContext,
): MediaInParens {
  if (value.type === 'general-enclosed') {
    return resolveGeneralEnclosed(value);
  }

  if (isMediaFeature(value.value)) {
    const resolved: MediaFeatureBlock = {
      ...value,
      value: resolveMediaFeature(value.value, stage, context),
    };
    return resolved;
  }

  const resolved: MediaConditionBlock = {
    ...value,
    value: resolveMediaCondition(value.value, stage, context),
  };
  return resolved;
}

function resolveMediaFeature(
  feature: MediaFeature,
  stage: ValueStage,
  context: MathContext,
): MediaFeature {
  if (feature.type === 'media-feature-boolean') return feature;

  if (feature.type === 'media-feature-plain') {
    return {
      ...feature,
      value: resolveMediaFeatureValue(feature.value, stage, context),
    };
  }

  return {
    ...feature,
    ...(feature.left === undefined
      ? {}
      : {
        left: {
          ...feature.left,
          value: resolveMediaFeatureValue(feature.left.value, stage, context),
        },
      }),
    ...(feature.right === undefined
      ? {}
      : {
        right: {
          ...feature.right,
          value: resolveMediaFeatureValue(feature.right.value, stage, context),
        },
      }),
  };
}

function resolveMediaFeatureValue(
  value: MediaFeatureValue,
  stage: ValueStage,
  context: MathContext,
): MediaFeatureValue {
  switch (value.type) {
    case 'ident':
      return resolveIdent(value);

    case 'dimension':
    case 'angle':
    case 'frequency':
    case 'length':
    case 'resolution':
    case 'time':
      return resolveDimension(value, stage, context);

    case 'number':
    case 'ratio':
      return resolveNumberOrRatio(value, stage, context);

    case 'math':
      return value.valueType === 'number'
        ? resolveNumberOrRatio(value, stage, context)
        : resolveDimension(value, stage, context);
  }
}

function serializeMediaCondition(condition: MediaCondition): string {
  switch (condition.type) {
    case 'media-not':
      return `not ${serializeMediaInParens(condition.value)}`;

    case 'media-and':
      return condition.values.map(serializeMediaInParens).join(' and ');

    case 'media-or':
      return condition.values.map(serializeMediaInParens).join(' or ');

    default:
      return serializeMediaInParens(condition);
  }
}

function serializeMediaInParens(value: MediaInParens): string {
  if (value.type === 'general-enclosed') {
    return serializeGeneralEnclosed(value);
  }

  const contents = isMediaFeature(value.value)
    ? serializeMediaFeature(value.value)
    : serializeMediaCondition(value.value);
  return `(${contents})`;
}

function serializeMediaFeature(feature: MediaFeature): string {
  const name = serializeCssIdentifier(feature.name);

  if (feature.type === 'media-feature-boolean') return name;

  if (feature.type === 'media-feature-plain') {
    return `${name}: ${serializeMediaFeatureValue(feature.value)}`;
  }

  const left = feature.left === undefined
    ? ''
    : `${serializeMediaFeatureValue(feature.left.value)} ${feature.left.comparison} `;
  const right = feature.right === undefined
    ? ''
    : ` ${feature.right.comparison} ${serializeMediaFeatureValue(feature.right.value)}`;
  return `${left}${name}${right}`;
}

function serializeMediaFeatureValue(value: MediaFeatureValue): string {
  switch (value.type) {
    case 'ident':
      return serializeIdent(value);

    case 'dimension':
    case 'angle':
    case 'frequency':
    case 'length':
    case 'resolution':
    case 'time':
      return serializeDimension(value);

    case 'number':
    case 'ratio':
      return serializeNumberOrRatio(value);

    case 'math':
      return value.valueType === 'number'
        ? serializeNumberOrRatio(value)
        : serializeDimension(value);
  }
}

function isMediaFeature(value: MediaCondition | MediaFeature): value is MediaFeature {
  switch (value.type) {
    case 'media-feature-plain':
    case 'media-feature-boolean':
    case 'media-feature-range':
      return true;

    default:
      return false;
  }
}

function invalidMediaQuery(): MediaTypeQuery {
  return {
    type: 'media-type-query',
    modifier: 'not',
    mediaType: 'all',
  };
}

// =============================================================================
// Syntax
// =============================================================================

/*
 * <media-query> = <media-condition>
 *               | [ not | only ]? <media-type>
 *                 [ and <media-condition-without-or> ]?
 * <media-type> = <ident>
 *
 * <media-condition> = <media-not>
 *                   | <media-in-parens> [ <media-and>* | <media-or>* ]
 * <media-condition-without-or> = <media-not> | <media-in-parens> <media-and>*
 * <media-not> = not <media-in-parens>
 * <media-and> = and <media-in-parens>
 * <media-or> = or <media-in-parens>
 * <media-in-parens> = ( <media-condition> )
 *                   | ( <media-feature> )
 *                   | <general-enclosed>
 *
 * <media-feature> = [ <mf-plain> | <mf-boolean> | <mf-range> ]
 * <mf-plain> = <mf-name> : <mf-value>
 * <mf-boolean> = <mf-name>
 * <mf-range> = <mf-name> <mf-comparison> <mf-value>
 *            | <mf-value> <mf-comparison> <mf-name>
 *            | <mf-value> <mf-lt> <mf-name> <mf-lt> <mf-value>
 *            | <mf-value> <mf-gt> <mf-name> <mf-gt> <mf-value>
 * <mf-name> = <ident>
 * <mf-value> = <number> | <dimension> | <ident> | <ratio>
 * <mf-lt> = '<' '='?
 * <mf-gt> = '>' '='?
 * <mf-eq> = '='
 * <mf-comparison> = <mf-lt> | <mf-gt> | <mf-eq>
 */

// <mf-name> = <ident>
const mediaFeatureNameConsumer = adaptConsumer(
  consumeIdentToken,
  (token) => asciiLower(token.value),
);

// <mf-value> = <number> | <dimension> | <ident> | <ratio>
const mediaFeatureValueConsumer = oneOf(
  [
    one(consumeNumberOrRatio),
    one(consumeDimension),
    one(consumeIdent),
  ],
  ([value]) => value,
);

// <mf-lt> = '<' '='?
const mediaFeatureLessConsumer = sequenceOf(
  [
    one(consumeLessDelim),
    opt(consumeEqualsDelim),
  ],
  ([, equals]): '<' | '<=' => equals.length === 0 ? '<' : '<=',
);

// <mf-gt> = '>' '='?
const mediaFeatureGreaterConsumer = sequenceOf(
  [
    one(consumeGreaterDelim),
    opt(consumeEqualsDelim),
  ],
  ([, equals]): '>' | '>=' => equals.length === 0 ? '>' : '>=',
);

// <mf-eq> = '='
const mediaFeatureEqualConsumer = consumeEqualsDelim;

// <mf-comparison> = <mf-lt> | <mf-gt> | <mf-eq>
const mediaFeatureComparisonConsumer = oneOf(
  [
    one(mediaFeatureLessConsumer),
    one(mediaFeatureGreaterConsumer),
    one(mediaFeatureEqualConsumer),
  ],
  ([comparison]) => comparison,
);

// <mf-plain> = <mf-name> : <mf-value>
const mediaFeaturePlainConsumer = sequenceOf(
  [
    one(mediaFeatureNameConsumer),
    one(withTrivia(consumeColon)),
    one(withTrivia(mediaFeatureValueConsumer)),
  ],
  ([[name], , [value]]): MediaFeaturePlain => ({
    type: 'media-feature-plain',
    name,
    value,
  }),
);

// <mf-boolean> = <mf-name>
const mediaFeatureBooleanConsumer = adaptConsumer(
  mediaFeatureNameConsumer,
  (name): MediaFeatureBoolean => ({
    type: 'media-feature-boolean',
    name,
  }),
);

// <mf-range> = <mf-name> <mf-comparison> <mf-value>
//            | <mf-value> <mf-comparison> <mf-name>
//            | <mf-value> <mf-lt> <mf-name> <mf-lt> <mf-value>
//            | <mf-value> <mf-gt> <mf-name> <mf-gt> <mf-value>
const mediaFeatureRangeConsumer = oneOf(
  [
    // The interval forms must precede the one-sided value-name form, which
    // can accept their first comparison as a complete prefix.
    one(createMediaFeatureIntervalConsumer(mediaFeatureLessConsumer)),
    one(createMediaFeatureIntervalConsumer(mediaFeatureGreaterConsumer)),
    one(sequenceOf(
      [
        one(mediaFeatureNameConsumer),
        one(withTrivia(mediaFeatureComparisonConsumer)),
        one(withTrivia(mediaFeatureValueConsumer)),
      ],
      ([[name], [comparison], [value]]): MediaFeatureRange => ({
        type: 'media-feature-range',
        name,
        right: { comparison, value },
      }),
    )),
    one(sequenceOf(
      [
        one(mediaFeatureValueConsumer),
        one(withTrivia(mediaFeatureComparisonConsumer)),
        one(withTrivia(mediaFeatureNameConsumer)),
      ],
      ([[value], [comparison], [name]]): MediaFeatureRange => ({
        type: 'media-feature-range',
        name,
        left: { comparison, value },
      }),
    )),
  ],
  ([range]) => range,
);

function createMediaFeatureIntervalConsumer(
  comparisonConsumer: TryConsumer<'<' | '<=' | '>' | '>='>,
): TryConsumer<MediaFeatureRange> {
  return sequenceOf(
    [
      one(mediaFeatureValueConsumer),
      one(withTrivia(comparisonConsumer)),
      one(withTrivia(mediaFeatureNameConsumer)),
      one(withTrivia(comparisonConsumer)),
      one(withTrivia(mediaFeatureValueConsumer)),
    ],
    ([[left], [leftComparison], [name], [rightComparison], [right]]) => ({
      type: 'media-feature-range',
      name,
      left: {
        comparison: leftComparison,
        value: left,
      },
      right: {
        comparison: rightComparison,
        value: right,
      },
    }),
  );
}

// <media-feature> = [ <mf-plain> | <mf-boolean> | <mf-range> ]
const mediaFeatureConsumer = oneOf(
  [
    one(mediaFeaturePlainConsumer),
    // <mf-boolean> is a prefix of name-first <mf-range>.
    one(mediaFeatureRangeConsumer),
    one(mediaFeatureBooleanConsumer),
  ],
  ([feature]) => feature,
);

// <media-in-parens> = ( <media-condition> ) | ( <media-feature> ) | <general-enclosed>
const mediaInParensConsumer: TryConsumer<MediaInParens> = oneOf(
  [
    one(adaptConsumer(
      consumeParensBlock,
      (component, context): MediaConditionBlock | null => {
        const value = parseAsComponentGrammar(
          component.value,
          withTrivia(mediaConditionConsumer),
          context,
        );

        return value === null ? null : { ...component, value };
      },
    )),
    one(adaptConsumer(
      consumeParensBlock,
      (component, context): MediaFeatureBlock | null => {
        const value = parseAsComponentGrammar(
          component.value,
          withTrivia(mediaFeatureConsumer),
          context,
        );

        return value === null ? null : { ...component, value };
      },
    )),
    one(consumeGeneralEnclosed),
  ],
  ([value]) => value,
);

// <media-not> = not <media-in-parens>
const mediaNotConsumer = sequenceOf(
  [
    one(createKeywordConsumer('not')),
    one(withTrivia(mediaInParensConsumer)),
  ],
  ([, [value]]): MediaNot => ({
    type: 'media-not',
    value,
  }),
);

// <media-and> = and <media-in-parens>
const mediaAndConsumer = sequenceOf(
  [
    one(withTrivia(createKeywordConsumer('and'))),
    one(withTrivia(mediaInParensConsumer)),
  ],
  ([, [value]]) => value,
);

// <media-or> = or <media-in-parens>
const mediaOrConsumer = sequenceOf(
  [
    one(withTrivia(createKeywordConsumer('or'))),
    one(withTrivia(mediaInParensConsumer)),
  ],
  ([, [value]]) => value,
);

// <media-condition-without-or> = <media-not> | <media-in-parens> <media-and>*
const mediaConditionWithoutOrConsumer: TryConsumer<MediaConditionWithoutOr> = oneOf(
  [
    one(mediaNotConsumer),
    one(sequenceOf(
      [
        one(mediaInParensConsumer),
        any(mediaAndConsumer),
      ],
      ([[first], rest]): MediaConditionWithoutOr => rest.length === 0
        ? first
        : {
          type: 'media-and',
          values: [first, rest[0]!, ...rest.slice(1)],
        },
    )),
  ],
  ([condition]) => condition,
);

/*
 * <media-condition> = <media-not>
 *                   | <media-in-parens> [ <media-and>* | <media-or>* ]
 *
 * Factorization:
 *
 * <media-condition> = <media-not>
 *                   | <media-in-parens> <media-and>+
 *                   | <media-in-parens> <media-or>+
 *                   | <media-in-parens>
 */
const mediaConditionConsumer: TryConsumer<MediaCondition> = oneOf(
  [
    one(mediaNotConsumer),
    one(sequenceOf(
      [
        one(mediaInParensConsumer),
        plus(mediaAndConsumer),
      ],
      ([[first], rest]): MediaAnd => ({
        type: 'media-and',
        values: [first, rest[0], ...rest.slice(1)],
      }),
    )),
    one(sequenceOf(
      [
        one(mediaInParensConsumer),
        plus(mediaOrConsumer),
      ],
      ([[first], rest]): MediaOr => ({
        type: 'media-or',
        values: [first, rest[0], ...rest.slice(1)],
      }),
    )),
    one(mediaInParensConsumer),
  ],
  ([condition]) => condition,
);

const excludedMediaTypes = new Set(['only', 'not', 'and', 'or', 'layer']);

// <media-type> = <ident>
const mediaTypeConsumer = adaptConsumer(
  consumeIdentToken,
  (token) => {
    const value = asciiLower(token.value);
    return excludedMediaTypes.has(value) ? null : value;
  },
);

// <media-query> = <media-condition>
//               | [ not | only ]? <media-type>
//                 [ and <media-condition-without-or> ]?
const mediaQueryConsumer: TryConsumer<MediaQuery> = oneOf(
  [
    one(adaptConsumer(
      mediaConditionConsumer,
      (condition): MediaConditionQuery => ({
        type: 'media-condition-query',
        condition,
      }),
    )),
    one(sequenceOf(
      [
        opt(createKeywordConsumer('not', 'only')),
        one(withTrivia(mediaTypeConsumer)),
        opt(sequenceOf(
          [
            one(withTrivia(createKeywordConsumer('and'))),
            one(withTrivia(mediaConditionWithoutOrConsumer)),
          ],
          ([, [condition]]) => condition,
        )),
      ],
      ([modifier, [mediaType], condition]): MediaTypeQuery => ({
        type: 'media-type-query',
        ...(modifier.length === 0 ? {} : { modifier: modifier[0] }),
        mediaType,
        ...(condition.length === 0 ? {} : { condition: condition[0] }),
      }),
    )),
  ],
  ([query]) => query,
);

const mediaQueryParser = createComponentParser(withTrivia(mediaQueryConsumer));
