import { ComponentCursor } from '../parser/component-cursor';
import type { ComponentValue } from '../parser/syntax';
import {
  consumeComponentTrivia,
  one,
  oneOf,
  repeatComma,
  type TryValueParser,
} from '../parser/component';
import { tryConsumeKeywordIn } from '../values/keyword';
import {
  serializeCustomIdent,
  tryParseCustomIdent,
  type CustomIdentValue,
} from '../values/custom-ident';
import {
  serializeString,
  tryParseString,
  type StringValue,
} from '../values/string';

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

const tryParseNone: TryValueParser<AnimationNameNoneValue> = (c) => {
  const value = tryConsumeKeywordIn(c, ['none'] as const);

  if (value === null) {
    return null;
  }

  return { type: 'none' };
};

const tryParseKeyframesName = oneOf(
  one((c) => tryParseCustomIdent(c, ['none'])),
  one(tryParseString),
);

const tryParseAnimationNameItemGrammar = oneOf(
  one(tryParseNone),
  tryParseKeyframesName,
);

const tryParseAnimationNameItem: TryValueParser<AnimationNameItemValue> = (c) => {
  const value = tryParseAnimationNameItemGrammar(c);

  if (value === null) {
    return null;
  }

  return value[0];
};

const tryParseAnimationNameList = repeatComma(
  tryParseAnimationNameItem,
  1,
);

export function tryParseAnimationName(c: ComponentCursor): AnimationNameValue | null {
  const start = c.pos();

  const values = tryParseAnimationNameList(c);

  if (values === null) {
    c.restore(start);
    return null;
  }

  return {
    type: 'animation-name',
    values,
  };
}

export function parseAnimationNameValue(
  components: readonly ComponentValue[],
): AnimationNameValue | null {
  const c = new ComponentCursor(components);
  const value = tryParseAnimationName(c);

  if (value === null) {
    return null;
  }

  consumeComponentTrivia(c);

  if (c.peek() !== null) {
    return null;
  }

  return value;
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
