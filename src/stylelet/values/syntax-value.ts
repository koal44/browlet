import {
  tryConsumeAsteriskDelim, tryConsumeGreaterDelim, tryConsumeHashDelim,
  tryConsumeIdentToken, tryConsumeLessDelim, tryConsumePipeDelim,
  tryConsumePlusDelim, tryConsumeStringToken,
} from '../parser/component-consumers';
import {
  type ComponentCursor, type TryComponentConsumer, type TryComponentConsumerResult,
} from '../parser/component-cursor';
import { serializeComponentValues, serializeCssIdentifier } from '../parser/component-value';
import {
  adaptConsumer, any, commaRepeat, one, oneOf, opt, plus, sequenceOf, withTrivia,
} from '../parser/component-grammar';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import { type PropertyContext, type ValueStage } from '../value-processing';
import { angleDef } from './angle';
import { colorDef } from './color';
import { customIdentDef } from './custom-ident';
import { imageDef } from './image';
import { integerDef } from './integer';
import { lengthPercentageDef } from './length-percentage';
import { lengthDef } from './length';
import { numberDef } from './number';
import { percentageDef } from './percentage';
import { resolutionDef } from './resolution';
import { stringDef } from './string';
import { timeDef } from './time';
import { urlDef } from './url';
import {
  tryConsumeOptionalDeclarationValue,
  type DeclarationComponent,
} from './declaration-value';

export type SyntaxValue =
  | UniversalSyntaxValue
  | SyntaxDefinitionValue;

export type ParsedSyntaxValue =
  | ParsedUniversalSyntax
  | ParsedSyntaxType
  | ParsedSyntaxKeyword
  | ParsedSyntaxList;

type ParsedUniversalSyntax = {
  type: 'parsed-universal-syntax';
  components: DeclarationComponent[];
};

type ParsedSyntaxType = {
  [Name in DefinedSyntaxTypeName]: {
    type: 'parsed-syntax-type';
    name: Name;
    value: DefValue<(typeof syntaxTypeDefs)[Name]>;
  };
}[DefinedSyntaxTypeName];

type ParsedSyntaxKeyword = {
  type: 'parsed-syntax-keyword';
  name: string;
};

type ParsedSyntaxList = {
  type: 'parsed-syntax-list';
  multiplier: SyntaxMultiplier;
  values: readonly [ParsedSyntaxComponent, ...ParsedSyntaxComponent[]];
};

type UniversalSyntaxValue = {
  type: 'universal-syntax';
};

type SyntaxDefinitionValue = {
  type: 'syntax-definition';
  components: SyntaxComponents;
};

type SyntaxComponents = [SyntaxComponent, ...SyntaxComponent[]];

type SyntaxComponent =
  | SyntaxTypeComponent
  | SyntaxKeywordComponent;

type SyntaxTypeComponent = {
  type: 'syntax-type';
  name: SyntaxTypeName;
  multiplier?: SyntaxMultiplier;
};

type SyntaxKeywordComponent = {
  type: 'syntax-keyword';
  name: string;
  multiplier?: SyntaxMultiplier;
};

type SyntaxTypeName = (typeof syntaxTypeNames)[number];

type SyntaxMultiplier = '+' | '#';

const syntaxTypeNames = [
  'length',
  'number',
  'percentage',
  'length-percentage',
  'string',
  'color',
  'image',
  'url',
  'integer',
  'angle',
  'time',
  'resolution',
  'transform-function',
  'custom-ident',
  'transform-list',
] as const;

const syntaxTypeDefs = {
  length: lengthDef,
  number: numberDef,
  percentage: percentageDef,
  'length-percentage': lengthPercentageDef,
  string: stringDef,
  color: colorDef,
  image: imageDef,
  url: urlDef,
  integer: integerDef,
  angle: angleDef,
  time: timeDef,
  resolution: resolutionDef,
  'custom-ident': customIdentDef,
} as const;

type DefinedSyntaxTypeName = keyof typeof syntaxTypeDefs;

type DefValue<Definition> =
  Definition extends { tryConsume: TryComponentConsumer<infer Value>; }
    ? Value
    : never;

export function parseSyntax(input: ParserInput): SyntaxValue | null {
  return parseAsComponentGrammar(input, withTrivia(tryConsumeSyntax));
}

export function tryConsumeSyntax(
  c: ComponentCursor,
): TryComponentConsumerResult<SyntaxValue> {
  return consumeSyntax(c);
}

export function createSyntaxConsumer(
  syntax: SyntaxValue,
): TryComponentConsumer<ParsedSyntaxValue> {
  if (syntax.type === 'universal-syntax') {
    return consumeUniversalSyntaxValue;
  }

  const clauses = syntax.components.map((component) =>
    one(adaptConsumer(
      withTrivia(createSyntaxComponentConsumer(component)),
      (value) => value,
      { complete: true },
    ))
  );

  return oneOf(clauses, ([value]) => value);
}

export function resolveParsedSyntaxValue(
  value: ParsedSyntaxValue,
  stage: ValueStage,
  context: PropertyContext,
): ParsedSyntaxValue {
  switch (value.type) {
    case 'parsed-universal-syntax':
    case 'parsed-syntax-keyword':
      return value;

    case 'parsed-syntax-type':
      return resolveParsedSyntaxType(value, stage, context);

    case 'parsed-syntax-list': {
      const [first, ...rest] = value.values;

      return {
        ...value,
        values: [
          resolveParsedSyntaxComponent(first, stage, context),
          ...rest.map((item) => resolveParsedSyntaxComponent(item, stage, context)),
        ],
      };
    }
  }
}

export function serializeParsedSyntaxValue(
  value: ParsedSyntaxValue,
): string {
  switch (value.type) {
    case 'parsed-universal-syntax':
      return serializeComponentValues(value.components);

    case 'parsed-syntax-keyword':
      return serializeCssIdentifier(value.name);

    case 'parsed-syntax-type':
      return serializeParsedSyntaxType(value);

    case 'parsed-syntax-list':
      return value.values
        .map(serializeParsedSyntaxComponent)
        .join(value.multiplier === '#' ? ', ' : ' ');
  }
}

// =============================================================================
// Syntax
// =============================================================================

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
const consumeSyntaxTypeName = adaptConsumer(
  tryConsumeIdentToken,
  (token): SyntaxSingleTypeName | null => token.value !== 'transform-list' &&
    syntaxTypeNameSet.has(token.value as SyntaxTypeName)
    ? token.value as SyntaxSingleTypeName
    : null,
);

// <syntax-single-component> = '<' <syntax-type-name> '>' | <ident>
const consumeSyntaxSingleComponent = oneOf(
  [
    one(sequenceOf(
      [
        one(tryConsumeLessDelim),
        one(consumeSyntaxTypeName),
        one(tryConsumeGreaterDelim),
      ],
      ([, [name]]): SyntaxTypeComponent => ({
        type: 'syntax-type',
        name,
      }),
    )),
    one(adaptConsumer(
      customIdentDef.tryConsume,
      (ident): SyntaxKeywordComponent => ({
        type: 'syntax-keyword',
        name: ident.value,
      }),
    )),
  ],
  ([value]) => value,
);

// <syntax-multiplier> = [ '#' | '+' ]
const consumeSyntaxMultiplier = oneOf(
  [
    one(tryConsumeHashDelim),
    one(tryConsumePlusDelim),
  ],
  ([value]): SyntaxMultiplier => value,
);

/*
 * <syntax-component> =
 *   <syntax-single-component> <syntax-multiplier>? |
 *   '<' transform-list '>'
 */
const consumeSyntaxComponent = oneOf(
  [
    one(sequenceOf(
      [
        one(consumeSyntaxSingleComponent),
        opt(consumeSyntaxMultiplier),
      ],
      ([[component], multiplier]): SyntaxComponent => multiplier.length === 0
        ? component
        : { ...component, multiplier: multiplier[0] },
    )),
    one(sequenceOf(
      [
        one(tryConsumeLessDelim),
        one(adaptConsumer(
          tryConsumeIdentToken,
          (token) => token.value === 'transform-list' ? token.value : null,
        )),
        one(tryConsumeGreaterDelim),
      ],
      (): SyntaxTypeComponent => ({
        type: 'syntax-type',
        name: 'transform-list',
      }),
    )),
  ],
  ([component]) => component,
);

// <syntax-combinator> = '|'
const consumeSyntaxCombinator = tryConsumePipeDelim;

// <syntax-string> = <string> whose value parses as <syntax>
const consumeSyntaxString = adaptConsumer(
  tryConsumeStringToken,
  (token) => parseSyntax(token.value),
);

/*
 * <syntax> =
 *   '*' |
 *   <syntax-component> [ <syntax-combinator> <syntax-component> ]* |
 *   <syntax-string>
 */
const consumeSyntax = oneOf(
  [
    one(adaptConsumer(
      tryConsumeAsteriskDelim,
      (): UniversalSyntaxValue => ({ type: 'universal-syntax' }),
    )),
    one(sequenceOf(
      [
        one(consumeSyntaxComponent),
        any(sequenceOf(
          [
            one(withTrivia(consumeSyntaxCombinator)),
            one(withTrivia(consumeSyntaxComponent)),
          ],
          ([, [component]]) => component,
        )),
      ],
      ([[first], rest]): SyntaxDefinitionValue => ({
        type: 'syntax-definition',
        components: [first, ...rest],
      }),
    )),
    one(consumeSyntaxString),
  ],
  ([value]) => value,
);

// =============================================================================
// Values parsed with a syntax
// =============================================================================

type ParsedSyntaxComponent =
  | ParsedSyntaxType
  | ParsedSyntaxKeyword;

function resolveParsedSyntaxComponent(
  value: ParsedSyntaxComponent,
  stage: ValueStage,
  context: PropertyContext,
): ParsedSyntaxComponent {
  return value.type === 'parsed-syntax-keyword'
    ? value
    : resolveParsedSyntaxType(value, stage, context);
}

function resolveParsedSyntaxType(
  parsed: ParsedSyntaxType,
  stage: ValueStage,
  context: PropertyContext,
): ParsedSyntaxType {
  switch (parsed.name) {
    case 'length':
      return { ...parsed, value: syntaxTypeDefs.length.resolve(parsed.value, stage, context) };
    case 'number':
      return { ...parsed, value: syntaxTypeDefs.number.resolve(parsed.value, stage, context) };
    case 'percentage':
      return { ...parsed, value: syntaxTypeDefs.percentage.resolve(parsed.value, stage, context) };
    case 'length-percentage':
      return { ...parsed, value: syntaxTypeDefs['length-percentage'].resolve(parsed.value, stage, context) };
    case 'string':
      return { ...parsed, value: syntaxTypeDefs.string.resolve(parsed.value, stage, context) };
    case 'color':
      return { ...parsed, value: syntaxTypeDefs.color.resolve(parsed.value, stage, context) };
    case 'image':
      return { ...parsed, value: syntaxTypeDefs.image.resolve(parsed.value, stage, context) };
    case 'url':
      return { ...parsed, value: syntaxTypeDefs.url.resolve(parsed.value, stage, context) };
    case 'integer':
      return { ...parsed, value: syntaxTypeDefs.integer.resolve(parsed.value, stage, context) };
    case 'angle':
      return { ...parsed, value: syntaxTypeDefs.angle.resolve(parsed.value, stage, context) };
    case 'time':
      return { ...parsed, value: syntaxTypeDefs.time.resolve(parsed.value, stage, context) };
    case 'resolution':
      return { ...parsed, value: syntaxTypeDefs.resolution.resolve(parsed.value, stage, context) };
    case 'custom-ident':
      return { ...parsed, value: syntaxTypeDefs['custom-ident'].resolve(parsed.value, stage, context) };
  }
}

function serializeParsedSyntaxComponent(value: ParsedSyntaxComponent): string {
  return value.type === 'parsed-syntax-keyword'
    ? serializeCssIdentifier(value.name)
    : serializeParsedSyntaxType(value);
}

function serializeParsedSyntaxType(value: ParsedSyntaxType): string {
  switch (value.name) {
    case 'length': return syntaxTypeDefs.length.serialize(value.value);
    case 'number': return syntaxTypeDefs.number.serialize(value.value);
    case 'percentage': return syntaxTypeDefs.percentage.serialize(value.value);
    case 'length-percentage': return syntaxTypeDefs['length-percentage'].serialize(value.value);
    case 'string': return syntaxTypeDefs.string.serialize(value.value);
    case 'color': return syntaxTypeDefs.color.serialize(value.value);
    case 'image': return syntaxTypeDefs.image.serialize(value.value);
    case 'url': return syntaxTypeDefs.url.serialize(value.value);
    case 'integer': return syntaxTypeDefs.integer.serialize(value.value);
    case 'angle': return syntaxTypeDefs.angle.serialize(value.value);
    case 'time': return syntaxTypeDefs.time.serialize(value.value);
    case 'resolution': return syntaxTypeDefs.resolution.serialize(value.value);
    case 'custom-ident': return syntaxTypeDefs['custom-ident'].serialize(value.value);
  }
}

function createSyntaxComponentConsumer(
  component: SyntaxComponent,
): TryComponentConsumer<ParsedSyntaxValue> {
  const consume: TryComponentConsumer<ParsedSyntaxComponent> =
    component.type === 'syntax-type'
      ? createSyntaxTypeConsumer(component.name)
      : adaptConsumer(
        tryConsumeIdentToken,
        (token): ParsedSyntaxKeyword | null =>
          token.value === component.name
            ? { type: 'parsed-syntax-keyword', name: component.name }
            : null,
      );

  switch (component.multiplier) {
    case '+':
      return adaptConsumer(
        plus(withTrivia(consume)),
        (values): ParsedSyntaxList => ({
          type: 'parsed-syntax-list',
          multiplier: '+',
          values,
        }),
      );

    case '#':
      return adaptConsumer(
        commaRepeat(withTrivia(consume)),
        (values): ParsedSyntaxList => ({
          type: 'parsed-syntax-list',
          multiplier: '#',
          values,
        }),
      );

    default:
      return consume;
  }
}

function createSyntaxTypeConsumer(
  name: SyntaxTypeName,
): TryComponentConsumer<ParsedSyntaxType> {
  switch (name) {
    case 'length':
      return adaptConsumer(syntaxTypeDefs.length.tryConsume, (value): ParsedSyntaxType => ({
        type: 'parsed-syntax-type', name, value,
      }));
    case 'number':
      return adaptConsumer(syntaxTypeDefs.number.tryConsume, (value): ParsedSyntaxType => ({
        type: 'parsed-syntax-type', name, value,
      }));
    case 'percentage':
      return adaptConsumer(syntaxTypeDefs.percentage.tryConsume, (value): ParsedSyntaxType => ({
        type: 'parsed-syntax-type', name, value,
      }));
    case 'length-percentage':
      return adaptConsumer(syntaxTypeDefs['length-percentage'].tryConsume, (value): ParsedSyntaxType => ({
        type: 'parsed-syntax-type', name, value,
      }));
    case 'string':
      return adaptConsumer(syntaxTypeDefs.string.tryConsume, (value): ParsedSyntaxType => ({
        type: 'parsed-syntax-type', name, value,
      }));
    case 'color':
      return adaptConsumer(syntaxTypeDefs.color.tryConsume, (value): ParsedSyntaxType => ({
        type: 'parsed-syntax-type', name, value,
      }));
    case 'image':
      return adaptConsumer(syntaxTypeDefs.image.tryConsume, (value): ParsedSyntaxType => ({
        type: 'parsed-syntax-type', name, value,
      }));
    case 'url':
      return adaptConsumer(syntaxTypeDefs.url.tryConsume, (value): ParsedSyntaxType => ({
        type: 'parsed-syntax-type', name, value,
      }));
    case 'integer':
      return adaptConsumer(syntaxTypeDefs.integer.tryConsume, (value): ParsedSyntaxType => ({
        type: 'parsed-syntax-type', name, value,
      }));
    case 'angle':
      return adaptConsumer(syntaxTypeDefs.angle.tryConsume, (value): ParsedSyntaxType => ({
        type: 'parsed-syntax-type', name, value,
      }));
    case 'time':
      return adaptConsumer(syntaxTypeDefs.time.tryConsume, (value): ParsedSyntaxType => ({
        type: 'parsed-syntax-type', name, value,
      }));
    case 'resolution':
      return adaptConsumer(syntaxTypeDefs.resolution.tryConsume, (value): ParsedSyntaxType => ({
        type: 'parsed-syntax-type', name, value,
      }));
    case 'transform-function':
      throw new Error('<transform-function> parsing is not implemented');
    case 'custom-ident':
      return adaptConsumer(syntaxTypeDefs['custom-ident'].tryConsume, (value): ParsedSyntaxType => ({
        type: 'parsed-syntax-type', name, value,
      }));
    case 'transform-list':
      throw new Error('<transform-list> parsing is not implemented');
  }
}

// '*' = <declaration-value>?
const consumeUniversalSyntaxValue = adaptConsumer(
  tryConsumeOptionalDeclarationValue,
  (value): ParsedUniversalSyntax => ({
    type: 'parsed-universal-syntax',
    components: value.components,
  }),
);
