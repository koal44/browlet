import { commaRepeat, one, oneOf, withComponentTrivia } from '../parser/component-grammar';
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
import {
  ok, unwrapParseResultOrThrow,
  type TryComponentParser, type TryComponentParserResult,
} from '../parser/component-try-parser';

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
  return unwrapParseResultOrThrow(
    parseAsComponentGrammar(
      input,
      withComponentTrivia(tryConsumeAnimationName),
      context,
    ),
    'animation-name value',
  );
}

export function tryConsumeAnimationName(c: ComponentCursor): TryComponentParserResult<AnimationNameValue> {
  const start = c.pos();

  const values = unwrapParseResultOrThrow(
    tryConsumeAnimationNameList(c),
    'animation-name list',
  );

  if (values === null) {
    c.restore(start);
    return null;
  }

  return ok({
    type: 'animation-name',
    values,
  });
}

const tryConsumeNone: TryComponentParser<AnimationNameNoneValue> = (c) => {
  const value = unwrapParseResultOrThrow(
    tryConsumeKeywordIn(c, ['none'] as const),
    'animation-name none',
  );

  if (value === null) {
    return null;
  }

  return ok({ type: 'none' });
};

const tryConsumeKeyframesName: TryComponentParser<KeyframesNameValue> = oneOf(
  [
    one((c) => tryConsumeCustomIdent(c, ['none'])),
    one(tryParseString),
  ],
  ([value]) => ok(value),
);

const tryConsumeAnimationNameItem: TryComponentParser<AnimationNameItemValue> = oneOf(
  [
    one(tryConsumeNone),
    one(tryConsumeKeyframesName),
  ],
  ([value]) => ok(value),
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
