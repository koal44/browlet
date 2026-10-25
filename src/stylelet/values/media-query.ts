import { asciiLower } from '../../infra/ascii';
import { mapTuple } from '../../infra/util';

import {
  createKeywordConsumer, consumeColon, consumeEqualsDelim, consumeGreaterDelim, consumeIdentToken, consumeLessDelim,
  consumeParensBlock, adaptConsumer, any, one, oneOf, opt, plus, sequenceOf, withTrivia,
  serializeCssIdentifier, createComponentParser, parseAsComponentGrammar, parseListAsComponentGrammar,
  parseListOfComponentValues, TokenKind,
  type ComponentValue, type TokenCursor, type ParserInput, type TryConsumer, type TryConsumerResult,
} from '../syntax/index';
import type { ValueStage } from '../value-processing/index';

import type { Value } from './value';
import { consumeDimension, type DimensionValue } from './dimension';
import { GeneralEnclosedValue } from './general-enclosed';
import { IdentValue } from './ident';
import type { MathContext } from './math-value';
import { consumeNumberOrRatio, type NumberOrRatioValue } from './ratio';

/** A media query retaining its condition syntax and interpreted feature values. */
// https://drafts.csswg.org/mediaqueries-4/#mq-syntax
export class MediaQuery<R extends MediaQuerySyntax = MediaQuerySyntax> implements Value<MathContext> {
  /** The media type, modifier, and condition at the current value stage. */
  repr: R;

  constructor(value: R) {
    this.repr = value;
  }

  /** Parse one complete media query without list error recovery. */
  static parse(input: ParserInput, context: MathContext): MediaQuery | null {
    return mediaQueryParser(input, context);
  }

  /** Parse independent queries, replacing invalid entries with not all. */
  // https://drafts.csswg.org/cssom/#parse-a-media-query-list
  static parseList(input: ParserInput, context: MathContext): MediaQuery[] {
    const list = parseListOfComponentValues(input, context);
    const queries = parseListAsComponentGrammar(list, mediaQueryGrammar, context)
      .map((query) => query ?? MediaQuery.#invalid());

    // SPEC_CLASH(media-query-trailing-comma): Follow browsers by retaining the
    // final empty query; Syntax's comma-list algorithm drops it. Inspect folded
    // components so a comma inside an unclosed function/block is not a separator.
    if (list.tokens.at(-1)?.type === TokenKind.Comma) queries.push(MediaQuery.#invalid());
    return queries;
  }

  /** Consume one query in the caller's numeric context. */
  static consume(this: void, c: TokenCursor<ComponentValue, MathContext>): TryConsumerResult<MediaQuery> {
    return mediaQueryConsumer(c);
  }

  /** Serialize a query list in its current order. */
  // https://drafts.csswg.org/cssom/#serialize-a-media-query-list
  static serializeList(queries: MediaQuery[]): string {
    return queries.map((query) => query.serialize()).join(', ');
  }

  static #invalid(): MediaQuery {
    return new MediaQuery({ type: 'media-type-query', modifier: 'not', mediaType: 'all' });
  }

  /** Resolve feature values without deciding whether this query matches a device. */
  resolve(stage: ValueStage, context: MathContext): MediaQuery {
    const query = this.repr;
    if (query.type === 'media-condition-query') {
      return new MediaQuery({
        ...query,
        condition: query.condition.resolve(stage, context),
      });
    }

    return new MediaQuery({
      ...query,
      ...(query.condition === undefined
        ? {}
        : { condition: query.condition.resolve(stage, context) }),
    });
  }

  /** Serialize the current query without resolving its values. */
  // https://drafts.csswg.org/cssom/#serialize-a-media-query
  serialize(): string {
    const query = this.repr;
    if (query.type === 'media-condition-query') {
      return query.condition.serialize();
    }

    const mediaType = serializeCssIdentifier(query.mediaType);
    // SPEC_CLASH(media-query-only-serialization): Preserve `only`, as all three
    // browsers do; CSSOM's written serializer only accounts for `not`.
    const head = query.modifier === undefined
      ? mediaType
      : `${query.modifier} ${mediaType}`;

    if (query.condition === undefined) return head;

    const condition = query.condition.serialize();
    return query.modifier === undefined && query.mediaType === 'all'
      ? condition
      : `${head} and ${condition}`;
  }
}

type MediaQuerySyntax =
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
  | MediaBlock
  | GeneralEnclosedValue;

/** Parentheses preserve grouping around a condition or feature. */
class MediaBlock implements Value<MathContext> {
  /** The interpreted contents of the parentheses. */
  repr: MediaCondition | MediaFeature;

  constructor(value: MediaCondition | MediaFeature) {
    this.repr = value;
  }

  resolve(stage: ValueStage, context: MathContext): MediaBlock {
    return new MediaBlock(this.repr.resolve(stage, context));
  }

  serialize(): string {
    return `(${this.repr.serialize()})`;
  }
}

/** A negated parenthesized condition or unknown condition grammar. */
class MediaNot implements Value<MathContext> {
  /** The condition following not. */
  repr: MediaInParens;

  constructor(value: MediaInParens) {
    this.repr = value;
  }

  resolve(stage: ValueStage, context: MathContext): MediaNot {
    return new MediaNot(this.repr.resolve(stage, context));
  }

  serialize(): string {
    return `not ${this.repr.serialize()}`;
  }
}

/** Conditions joined by one operator, retaining their grammar order. */
class MediaJunction<Operator extends 'and' | 'or'> implements Value<MathContext> {
  /** The operator also distinguishes conditions allowed after a media type. */
  operator: Operator;
  /** Two or more parenthesized operands. */
  values: MediaConditionOperands;

  constructor(operator: Operator, values: MediaConditionOperands) {
    this.operator = operator;
    this.values = values;
  }

  resolve(stage: ValueStage, context: MathContext): MediaJunction<Operator> {
    return new MediaJunction(this.operator, mapTuple(this.values, (value) => value.resolve(stage, context)));
  }

  serialize(): string {
    return this.values.map((value) => value.serialize()).join(` ${this.operator} `);
  }
}

type MediaAnd = MediaJunction<'and'>;
type MediaOr = MediaJunction<'or'>;
type MediaConditionOperands = [MediaInParens, MediaInParens, ...MediaInParens[]];
type MediaFeature = MediaFeaturePlain | MediaFeatureBoolean | MediaFeatureRange;

/** A named feature with a single value after a colon. */
class MediaFeaturePlain implements Value<MathContext> {
  /** The ASCII-lowercase feature name. */
  name: string;
  /** The value interpreted by the generic media-feature grammar. */
  repr: MediaFeatureValue;

  constructor(name: string, value: MediaFeatureValue) {
    this.name = name;
    this.repr = value;
  }

  resolve(stage: ValueStage, context: MathContext): MediaFeaturePlain {
    return new MediaFeaturePlain(this.name, this.repr.resolve(stage, context));
  }

  serialize(): string {
    return `${serializeCssIdentifier(this.name)}: ${this.repr.serialize()}`;
  }
}

/** A feature tested without an explicit value. */
class MediaFeatureBoolean implements Value<MathContext> {
  /** The ASCII-lowercase feature name. */
  name: string;

  constructor(name: string) {
    this.name = name;
  }

  resolve(_stage: ValueStage, _context: MathContext): MediaFeatureBoolean {
    return this;
  }

  serialize(): string {
    return serializeCssIdentifier(this.name);
  }
}

/** One or two comparisons around a named feature. */
class MediaFeatureRange implements Value<MathContext> {
  /** The ASCII-lowercase feature name. */
  name: string;
  /** The optional comparison preceding the feature name. */
  left: MediaFeatureBound | undefined;
  /** The optional comparison following the feature name. */
  right: MediaFeatureBound | undefined;

  constructor(name: string, left?: MediaFeatureBound, right?: MediaFeatureBound) {
    this.name = name;
    this.left = left;
    this.right = right;
  }

  resolve(stage: ValueStage, context: MathContext): MediaFeatureRange {
    const left = this.left === undefined ? undefined
      : { comparison: this.left.comparison, value: this.left.value.resolve(stage, context) };
    const right = this.right === undefined ? undefined
      : { comparison: this.right.comparison, value: this.right.value.resolve(stage, context) };
    return new MediaFeatureRange(this.name, left, right);
  }

  serialize(): string {
    const left = this.left === undefined ? ''
      : `${this.left.value.serialize()} ${this.left.comparison} `;
    const right = this.right === undefined ? ''
      : ` ${this.right.comparison} ${this.right.value.serialize()}`;
    return `${left}${serializeCssIdentifier(this.name)}${right}`;
  }
}

type MediaFeatureBound = {
  comparison: MediaFeatureComparison;
  value: MediaFeatureValue;
};
type MediaFeatureValue = NumberOrRatioValue | DimensionValue | IdentValue;
type MediaFeatureComparison = '<' | '<=' | '>' | '>=' | '=';

/** Canonicalize the keyword productions specified by CSSOM; preserve unknown values. */
// https://drafts.csswg.org/cssom/#serialize-a-media-feature-value
// Remaining feature grammars belong to Conditional Rules, not this generic parser.
function canonicalizeMediaFeatureValue(name: string, value: MediaFeatureValue): MediaFeatureValue {
  if (!(value instanceof IdentValue) || (name !== 'orientation' && name !== 'scan')) return value;

  const keyword = asciiLower(value.repr);
  if (name === 'orientation'
    ? keyword === 'landscape' || keyword === 'portrait'
    : keyword === 'progressive' || keyword === 'interlace'
  ) {
    return new IdentValue(keyword);
  }
  return value;
}

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
    one(IdentValue.consume),
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
  ([[name], , [value]]) => new MediaFeaturePlain(name, canonicalizeMediaFeatureValue(name, value)),
);

// <mf-boolean> = <mf-name>
const mediaFeatureBooleanConsumer = adaptConsumer(
  mediaFeatureNameConsumer,
  (name) => new MediaFeatureBoolean(name),
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
      ([[name], [comparison], [value]]) => new MediaFeatureRange(name, undefined, { comparison, value }),
    )),
    one(sequenceOf(
      [
        one(mediaFeatureValueConsumer),
        one(withTrivia(mediaFeatureComparisonConsumer)),
        one(withTrivia(mediaFeatureNameConsumer)),
      ],
      ([[value], [comparison], [name]]) => new MediaFeatureRange(name, { comparison, value }),
    )),
  ],
  ([range]) => range,
);

function createMediaFeatureIntervalConsumer(
  comparisonConsumer: TryConsumer<'<' | '<=' | '>' | '>=', MathContext>,
): TryConsumer<MediaFeatureRange, MathContext> {
  return sequenceOf(
    [
      one(mediaFeatureValueConsumer),
      one(withTrivia(comparisonConsumer)),
      one(withTrivia(mediaFeatureNameConsumer)),
      one(withTrivia(comparisonConsumer)),
      one(withTrivia(mediaFeatureValueConsumer)),
    ],
    ([[left], [leftComparison], [name], [rightComparison], [right]]) => new MediaFeatureRange(
      name,
      { comparison: leftComparison, value: left },
      { comparison: rightComparison, value: right },
    ),
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
const mediaInParensConsumer: TryConsumer<MediaInParens, MathContext> = oneOf(
  [
    one(adaptConsumer(
      consumeParensBlock,
      (component, context: MathContext): MediaBlock | null => {
        const value = parseAsComponentGrammar(
          component.value,
          withTrivia(mediaConditionConsumer),
          context,
        );

        return value === null ? null : new MediaBlock(value);
      },
    )),
    one(adaptConsumer(
      consumeParensBlock,
      (component, context: MathContext): MediaBlock | null => {
        const value = parseAsComponentGrammar(
          component.value,
          withTrivia(mediaFeatureConsumer),
          context,
        );

        return value === null ? null : new MediaBlock(value);
      },
    )),
    one(GeneralEnclosedValue.consume),
  ],
  ([value]) => value,
);

// <media-not> = not <media-in-parens>
const mediaNotConsumer = sequenceOf(
  [
    one(createKeywordConsumer('not')),
    one(withTrivia(mediaInParensConsumer)),
  ],
  ([, [value]]) => new MediaNot(value),
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
const mediaConditionWithoutOrConsumer: TryConsumer<MediaConditionWithoutOr, MathContext> = oneOf(
  [
    one(mediaNotConsumer),
    one(sequenceOf(
      [
        one(mediaInParensConsumer),
        any(mediaAndConsumer),
      ],
      ([[first], rest]): MediaConditionWithoutOr => rest.length === 0
        ? first
        : new MediaJunction('and', [first, rest[0]!, ...rest.slice(1)]),
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
const mediaConditionConsumer: TryConsumer<MediaCondition, MathContext> = oneOf(
  [
    one(mediaNotConsumer),
    one(sequenceOf(
      [
        one(mediaInParensConsumer),
        plus(mediaAndConsumer),
      ],
      ([[first], rest]) => new MediaJunction('and', [first, rest[0], ...rest.slice(1)]),
    )),
    one(sequenceOf(
      [
        one(mediaInParensConsumer),
        plus(mediaOrConsumer),
      ],
      ([[first], rest]) => new MediaJunction('or', [first, rest[0], ...rest.slice(1)]),
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
const mediaQueryConsumer: TryConsumer<MediaQuery, MathContext> = oneOf(
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
  ([query]) => new MediaQuery(query),
);

const mediaQueryGrammar = withTrivia(mediaQueryConsumer);
const mediaQueryParser = createComponentParser(mediaQueryGrammar);
