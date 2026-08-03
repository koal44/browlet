import { commaRepeat, one, oneOf, sequenceOf, withTrivia } from '../parser/component-grammar';
import { createKeywordConsumer } from '../values/keyword';
import {
  createCustomIdentConsumer, serializeCustomIdent,
  type CustomIdentValue,
} from '../values/custom-ident';
import { serializeString, tryConsumeString, type StringValue } from '../values/string';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import { type ComponentCursor, type TryComponentConsumer, type TryComponentConsumerResult } from '../parser/component-cursor';

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
  return parseAsComponentGrammar(
    input,
    withTrivia(tryConsumeAnimationName),
    context,
  );
}

export function tryConsumeAnimationName(c: ComponentCursor): TryComponentConsumerResult<AnimationNameValue> {
  return consumeAnimationName(c);
}

const tryConsumeNone: TryComponentConsumer<AnimationNameNoneValue> = (c) => {
  const value = tryConsumeNoneKeyword(c);

  if (value === null) {
    return null;
  }

  return { type: 'none' };
};

const tryConsumeNoneKeyword = createKeywordConsumer('none');
const tryConsumeKeyframesCustomIdent = createCustomIdentConsumer(['none']);

const tryConsumeKeyframesName: TryComponentConsumer<KeyframesNameValue> = oneOf(
  [
    one(tryConsumeKeyframesCustomIdent),
    one(tryConsumeString),
  ],
  ([value]) => value,
);

const tryConsumeAnimationNameItem: TryComponentConsumer<AnimationNameItemValue> = oneOf(
  [
    one(tryConsumeNone),
    one(tryConsumeKeyframesName),
  ],
  ([value]) => value,
);

const consumeAnimationName = sequenceOf(
  [commaRepeat(tryConsumeAnimationNameItem, 1)],
  ([values]): AnimationNameValue => ({ type: 'animation-name', values }),
);

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
