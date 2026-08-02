import { describe, expect, it } from 'vitest';
import { withTrivia } from '../../../../src/stylelet/parser/component-grammar';
import { unwrapConsumeResultOrThrow } from '../../../../src/stylelet/parser/component-try-consumer';
import { parseAsComponentGrammar } from '../../../../src/stylelet/parser/syntax';
import { ValueStage } from '../../../../src/stylelet/value-processing';
import {
  ColorKind, resolveColorValue, serializeColorValue, tryConsumeColor,
  type ColorContext, type ColorValue,
} from '../../../../src/stylelet/values/color';
import {
  createWholeValueConsumer,
  type WholeValue,
} from '../../../../src/stylelet/values/whole-value';

describe('whole value', () => {
  const consumeColorWholeValue = createWholeValueConsumer(
    tryConsumeColor,
    resolveColorValue,
    serializeColorValue,
  );

  it('wraps, serializes, and resolves an ordinary color value', () => {
    const result = parseAsComponentGrammar(
      'red',
      withTrivia(consumeColorWholeValue),
    );
    const value: WholeValue<ColorValue, ColorContext> | null =
      unwrapConsumeResultOrThrow(result, '<whole-value>');

    expect(value).not.toBeNull();
    expect(value).toMatchObject({
      type: 'whole-value',
      value: {
        kind: ColorKind.Named,
        name: 'red',
      },
    });
    expect(value!.serialize()).toBe('red');
    expect(value!.resolve(ValueStage.Computed, {})).toMatchObject({
      type: 'whole-value',
      value: {
        kind: ColorKind.Absolute,
      },
    });
  });

});
