import {
  createKeywordConsumer, commaRepeat, one, oneOf, withTrivia, createComponentParser,
  type ParserInput, type TokenCursor, type TryConsumer, type TryConsumerResult,
} from '../syntax/index';
import type { ValueStage } from '../value-processing/index';
import { CustomIdentValue, StringValue, type Value } from '../values/index';

/*
 * <'animation-name'> = [ none | <keyframes-name> ]#
 * <keyframes-name> = <custom-ident> | <string>
 */

/** An ordered list of animation names; animation effect lookup is not connected yet. */
export class AnimationNameValue implements Value {
  /** Keyframe names or the none keyword for each animation. */
  value: AnimationNameItemValue[];

  constructor(value: AnimationNameItemValue[]) {
    this.value = value;
  }

  static parse(input: ParserInput, context: unknown): AnimationNameValue | null {
    return animationNameParser(input, context);
  }

  static consume(this: void, c: TokenCursor): TryConsumerResult<AnimationNameValue> {
    return animationNameConsumer(c);
  }

  resolve(_stage: ValueStage, _context: unknown): AnimationNameValue {
    return this;
  }

  serialize(): string {
    return this.value.map((item) => item === 'none' ? item : item.serialize()).join(', ');
  }
}

export type AnimationNameItemValue = 'none' | CustomIdentValue | StringValue;

// <animation-name-item> = none | <keyframes-name>
const animationNameItemConsumer: TryConsumer<AnimationNameItemValue> = oneOf(
  [
    one(createKeywordConsumer('none')),
    one(CustomIdentValue.createConsumer(['none'])),
    one(StringValue.consume),
  ],
  ([value]) => value,
);

// <'animation-name'> = <animation-name-item>#
const animationNameConsumer: TryConsumer<AnimationNameValue> = (c) => {
  const items = animationNameItemsConsumer(c);
  return items === null ? null : new AnimationNameValue(items);
};
const animationNameItemsConsumer = commaRepeat(animationNameItemConsumer, 1);
const animationNameParser = createComponentParser(withTrivia(animationNameConsumer));
