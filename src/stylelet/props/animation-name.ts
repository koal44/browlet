import {
  commaRepeat, one, oneOf, withComponentTrivia,
  type TryComponentParser,
} from '../parser/component-grammar';
import { tryConsumeKeywordIn } from '../values/keyword';
import {
  serializeCustomIdent, tryConsumeCustomIdent,
  type CustomIdentValue,
} from '../values/custom-ident';
import {
  serializeString, tryParseString,
  type StringValue,
} from '../values/string';
import {
  parseAsComponentGrammar,
  type ParserInput,
} from '../parser/syntax';
import type { ComponentCursor } from '../parser/component-cursor';

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
    withComponentTrivia(tryConsumeAnimationName),
    context,
  );
}

export function tryConsumeAnimationName(c: ComponentCursor): AnimationNameValue | null {
  const start = c.pos();

  const values = tryConsumeAnimationNameList(c);

  if (values === null) {
    c.restore(start);
    return null;
  }

  return {
    type: 'animation-name',
    values,
  };
}

const tryConsumeNone: TryComponentParser<AnimationNameNoneValue> = (c) => {
  const value = tryConsumeKeywordIn(c, ['none'] as const);

  if (value === null) {
    return null;
  }

  return { type: 'none' };
};

const tryConsumeKeyframesName: TryComponentParser<KeyframesNameValue> = oneOf(
  [
    one((c) => tryConsumeCustomIdent(c, ['none'])),
    one(tryParseString),
  ],
  ([value]): KeyframesNameValue => value,
);

const tryConsumeAnimationNameItem: TryComponentParser<AnimationNameItemValue> = oneOf(
  [
    one(tryConsumeNone),
    one(tryConsumeKeyframesName),
  ],
  ([value]): AnimationNameItemValue => value,
);

const tryConsumeAnimationNameList = commaRepeat(
  tryConsumeAnimationNameItem,
  1,
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
