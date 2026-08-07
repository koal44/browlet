import {
  adaptConsumer, commaRepeat, one, oneOf, sequenceOf, withTrivia,
} from '../syntax/component-grammar';
import { createKeywordConsumer } from '../values/keyword';
import {
  createCustomIdentConsumer, serializeCustomIdent,
  type CustomIdentValue,
} from '../values/custom-ident';
import { serializeString, consumeString, type StringValue } from '../values/string';
import { createComponentParser, type ParserInput } from '../syntax/parser';
import {
  type TokenCursor, type TryConsumer, type TryConsumerResult,
} from '../syntax/token-cursor';

/*
 * <'animation-name'> = [ none | <keyframes-name> ]#
 * <keyframes-name> = <custom-ident> | <string>
 */

export type AnimationNameValue = {
  type: 'animation-name';
  values: AnimationNameItemValue[];
};

export type AnimationNameItemValue =
  | AnimationNameNoneValue
  | KeyframesNameValue;

export type AnimationNameNoneValue = {
  type: 'none';
};

export type KeyframesNameValue =
  | CustomIdentValue
  | StringValue;

export function parseAnimationNameValue(
  input: ParserInput,
  context: unknown = undefined,
): AnimationNameValue | null {
  return animationNameParser(input, context);
}

export function consumeAnimationName(
  c: TokenCursor,
): TryConsumerResult<AnimationNameValue> {
  return animationNameConsumer(c);
}

export function serializeAnimationName(value: AnimationNameValue): string {
  return value.values.map(serializeAnimationNameItem).join(', ');
}

function serializeAnimationNameItem(value: AnimationNameItemValue): string {
  switch (value.type) {
    case 'none':
      return 'none';

    case 'custom-ident':
      return serializeCustomIdent(value);

    case 'string':
      return serializeString(value);
  }
}

// =============================================================================
// Syntax
// =============================================================================

/*
 * Implementation factorization of <'animation-name'>:
 *
 * <animation-name-none> = none
 * <animation-name-item> = <animation-name-none> | <keyframes-name>
 * <'animation-name'> = <animation-name-item>#
 */

// <keyframes-name> = <custom-ident> | <string>
const keyframesNameConsumer: TryConsumer<KeyframesNameValue> = oneOf(
  [
    one(createCustomIdentConsumer(['none'])),
    one(consumeString),
  ],
  ([value]) => value,
);

// <animation-name-none> = none
const animationNameNoneConsumer: TryConsumer<AnimationNameNoneValue> = adaptConsumer(
  createKeywordConsumer('none'),
  (): AnimationNameNoneValue => ({ type: 'none' }),
);

// <animation-name-item> = <animation-name-none> | <keyframes-name>
const animationNameItemConsumer: TryConsumer<AnimationNameItemValue> = oneOf(
  [
    one(animationNameNoneConsumer),
    one(keyframesNameConsumer),
  ],
  ([value]) => value,
);

// <'animation-name'> = <animation-name-item>#
const animationNameConsumer: TryConsumer<AnimationNameValue> = sequenceOf(
  [commaRepeat(animationNameItemConsumer, 1)],
  ([values]): AnimationNameValue => ({ type: 'animation-name', values }),
);

const animationNameParser = createComponentParser(withTrivia(animationNameConsumer));
