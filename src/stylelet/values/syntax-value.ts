import { InternalError } from '../../infra/internal-error';
import { mapTuple } from '../../infra/util';

import {
  consumeAsteriskDelim, consumeGreaterDelim, consumeHashDelim, consumeIdentToken, consumeLessDelim,
  consumePipeDelim, consumePlusDelim, consumeStringToken, serializeCssIdentifier,
  adaptConsumer, any, commaRepeat, one, oneOf, opt, plus, sequenceOf, withTrivia, createComponentParser,
  type TokenCursor, type TryConsumer, type TryConsumerResult, type ParserInput,
} from '../syntax/index';
import type { ValueStage } from '../value-processing/index';
import type { PropertyContext } from '../props/index';

import type { Value } from './value';
import { OptionalDeclarationValue } from './declaration-value';
import { AngleValue } from './angle';
import { ColorValue } from './color';
import { CustomIdentValue } from './custom-ident';
import { IdentValue } from './ident';
import { consumeImage } from './image';
import { IntegerValue } from './integer';
import { LengthPercentageValue } from './length-percentage';
import { LengthValue } from './length';
import { NumberValue } from './number';
import { PercentageValue } from './percentage';
import { ResolutionValue } from './resolution';
import { StringValue } from './string';
import { TimeValue } from './time';
import { UrlValue } from './url';

/** A registered syntax description, independent of any property or resolution context. */
export class SyntaxValue<Representation extends Syntax = Syntax> implements Value {
  /** The universal syntax or ordered alternatives, including their multipliers. */
  value: Representation;

  constructor(value: Representation) {
    this.value = value;
  }

  /** Parse a complete syntax description, including its quoted form. */
  static parse(input: ParserInput, context: unknown): SyntaxValue | null {
    return syntaxParser(input, context);
  }

  /** Consume one syntax description. */
  static consume(this: void, c: TokenCursor): TryConsumerResult<SyntaxValue> {
    return syntaxConsumer(c);
  }

  static #createComponentConsumer(component: SyntaxComponent): TryConsumer<ParsedSyntaxValue, PropertyContext> {
    let consume: TryConsumer<ParsedSyntaxComponent, PropertyContext>;
    if (component.type === 'syntax-keyword') {
      consume = adaptConsumer(consumeIdentToken, (token) => token.value === component.name ? new IdentValue(token.value) : null);
    } else {
      const name = component.name;
      if (name === 'transform-function' || name === 'transform-list') {
        throw new InternalError(`<${name}> parsing is not implemented`);
      }
      consume = syntaxTypeConsumers[name];
    }

    switch (component.multiplier) {
      case '+':
        return adaptConsumer(plus(withTrivia(consume)), (values) => new SyntaxListValue({ multiplier: '+', values }));
      case '#':
        return adaptConsumer(commaRepeat(withTrivia(consume)), (values) => new SyntaxListValue({ multiplier: '#', values }));
      default:
        return consume;
    }
  }

  /** Compile this registration's grammar once; parsed values own their lifecycle. */
  createParser(): (input: ParserInput, context: PropertyContext) => ParsedSyntaxValue | null {
    return createComponentParser(withTrivia(this.createConsumer()));
  }

  /** Consume a value matching one complete registered syntax alternative. */
  createConsumer(): TryConsumer<ParsedSyntaxValue, PropertyContext> {
    if (this.value.type === 'universal-syntax') return OptionalDeclarationValue.consume;
    const clauses = this.value.components.map((component) =>
      one(adaptConsumer(
        withTrivia(SyntaxValue.#createComponentConsumer(component)),
        (value) => value,
        { complete: true },
      ))
    );
    return oneOf(clauses, ([value]) => value);
  }

  /** A syntax description does not depend on property-resolution context. */
  resolve(_stage: ValueStage, _context: unknown): SyntaxValue<Representation> {
    return this;
  }

  /** Serialize the retained alternatives and their multipliers. */
  serialize(): string {
    if (this.value.type === 'universal-syntax') return '*';
    return this.value.components.map((component) => {
      const name = component.type === 'syntax-type'
        ? `<${component.name}>`
        : serializeCssIdentifier(component.name);
      return name + (component.multiplier ?? '');
    }).join(' | ');
  }
}

/** Registered scalar values keep their concrete classes instead of a second type dispatcher. */
export type ParsedSyntaxValue = ParsedSyntaxComponent | SyntaxListValue | OptionalDeclarationValue;

type Syntax =
  | { type: 'universal-syntax'; }
  | { type: 'syntax-definition'; components: [SyntaxComponent, ...SyntaxComponent[]]; };

type SyntaxComponent = SyntaxTypeComponent | SyntaxKeywordComponent;
type SyntaxTypeComponent = { type: 'syntax-type'; name: SyntaxTypeName; multiplier?: SyntaxMultiplier; };
type SyntaxKeywordComponent = { type: 'syntax-keyword'; name: string; multiplier?: SyntaxMultiplier; };
type SyntaxTypeName = (typeof syntaxTypeNames)[number];
type SyntaxMultiplier = '+' | '#';

/** A multiplied registered syntax component with its specified separator. */
export class SyntaxListValue implements Value<PropertyContext> {
  /** Nonempty values and the grammar multiplier that separates them. */
  value: { multiplier: SyntaxMultiplier; values: [ParsedSyntaxComponent, ...ParsedSyntaxComponent[]]; };

  constructor(value: SyntaxListValue['value']) {
    this.value = value;
  }

  /** Resolve each item, retaining the list when all items retain their identity. */
  resolve(stage: ValueStage, context: PropertyContext): SyntaxListValue {
    const previous = this.value.values;
    const values = mapTuple(previous, (item) => item.resolve(stage, context));
    return values.every((item, index) => item === previous[index])
      ? this : new SyntaxListValue({ multiplier: this.value.multiplier, values });
  }

  /** Serialize each item with the separator selected by its grammar. */
  serialize(): string {
    return this.value.values.map((item) => item.serialize()).join(this.value.multiplier === '#' ? ', ' : ' ');
  }
}

const syntaxTypeNames = [
  'length', 'number', 'percentage', 'length-percentage', 'string', 'color', 'image', 'url',
  'integer', 'angle', 'time', 'resolution', 'transform-function', 'custom-ident', 'transform-list',
] as const;

const syntaxTypeConsumers = {
  length: LengthValue.consume,
  number: NumberValue.consume,
  percentage: PercentageValue.consume,
  'length-percentage': LengthPercentageValue.consume,
  string: StringValue.consume,
  color: ColorValue.consume,
  image: consumeImage,
  url: UrlValue.consume,
  integer: IntegerValue.consume,
  angle: AngleValue.consume,
  time: TimeValue.consume,
  resolution: ResolutionValue.consume,
  'custom-ident': CustomIdentValue.consume,
};

type ParsedSyntaxComponent =
  | Exclude<ReturnType<(typeof syntaxTypeConsumers)[keyof typeof syntaxTypeConsumers]>, null>
  | IdentValue;

/*
 * <syntax> = '*' | <syntax-component> [ <syntax-combinator> <syntax-component> ]* | <syntax-string>
 * <syntax-component> = <syntax-single-component> <syntax-multiplier>?
 *                    | '<' transform-list '>'
 * <syntax-single-component> = '<' <syntax-type-name> '>' | <ident>
 * <syntax-type-name> = angle | color | custom-ident | image | integer
 *                    | length | length-percentage | number
 *                    | percentage | resolution | string | time
 *                    | url | transform-function
 * <syntax-combinator> = '|'
 * <syntax-multiplier> = [ '#' | '+' ]
 *
 * <syntax-string> = <string>
 */

type SyntaxSingleTypeName = Exclude<SyntaxTypeName, 'transform-list'>;

const syntaxTypeNameSet = new Set<SyntaxTypeName>(syntaxTypeNames);

// <syntax-type-name>
const syntaxTypeNameConsumer = adaptConsumer(
  consumeIdentToken,
  (token): SyntaxSingleTypeName | null => token.value !== 'transform-list' &&
    syntaxTypeNameSet.has(token.value as SyntaxTypeName)
    ? token.value as SyntaxSingleTypeName
    : null,
);

// <syntax-single-component> = '<' <syntax-type-name> '>' | <ident>
const syntaxSingleComponentConsumer = oneOf(
  [
    one(sequenceOf(
      [
        one(consumeLessDelim),
        one(syntaxTypeNameConsumer),
        one(consumeGreaterDelim),
      ],
      ([, [name]]): SyntaxTypeComponent => ({
        type: 'syntax-type',
        name,
      }),
    )),
    one(adaptConsumer(
      CustomIdentValue.consume,
      (ident): SyntaxKeywordComponent => ({
        type: 'syntax-keyword',
        name: ident.value,
      }),
    )),
  ],
  ([value]) => value,
);

// <syntax-multiplier> = [ '#' | '+' ]
const syntaxMultiplierConsumer = oneOf(
  [
    one(consumeHashDelim),
    one(consumePlusDelim),
  ],
  ([value]): SyntaxMultiplier => value,
);

/*
 * <syntax-component> =
 *   <syntax-single-component> <syntax-multiplier>? |
 *   '<' transform-list '>'
 */
const syntaxComponentConsumer = oneOf(
  [
    one(sequenceOf(
      [
        one(syntaxSingleComponentConsumer),
        opt(syntaxMultiplierConsumer),
      ],
      ([[component], multiplier]): SyntaxComponent => multiplier.length === 0
        ? component
        : { ...component, multiplier: multiplier[0] },
    )),
    one(sequenceOf(
      [
        one(consumeLessDelim),
        one(adaptConsumer(
          consumeIdentToken,
          (token) => token.value === 'transform-list' ? token.value : null,
        )),
        one(consumeGreaterDelim),
      ],
      (): SyntaxTypeComponent => ({
        type: 'syntax-type',
        name: 'transform-list',
      }),
    )),
  ],
  ([component]) => component,
);

// <syntax-string> = <string> whose value parses as <syntax>
const syntaxStringConsumer = adaptConsumer(
  consumeStringToken,
  (token, context) => SyntaxValue.parse(token.value, context),
);

/*
 * <syntax> =
 *   '*' |
 *   <syntax-component> [ <syntax-combinator> <syntax-component> ]* |
 *   <syntax-string>
 */
const syntaxConsumer = oneOf(
  [
    one(adaptConsumer(
      consumeAsteriskDelim,
      () => new SyntaxValue({ type: 'universal-syntax' }),
    )),
    one(sequenceOf(
      [
        one(syntaxComponentConsumer),
        any(sequenceOf(
          [
            one(withTrivia(consumePipeDelim)),
            one(withTrivia(syntaxComponentConsumer)),
          ],
          ([, [component]]) => component,
        )),
      ],
      ([[first], rest]) => new SyntaxValue({
        type: 'syntax-definition',
        components: [first, ...rest],
      }),
    )),
    one(syntaxStringConsumer),
  ],
  ([value]) => value,
);

const syntaxParser = createComponentParser(withTrivia(syntaxConsumer));
