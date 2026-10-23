import { describe, expect, expectTypeOf, it } from 'vitest';
import { AnyValue } from '../../../../src/stylelet/values/any-value';
import { TokenCursor } from '../../../../src/stylelet/syntax/token-cursor';
import { TokenKind } from '../../../../src/stylelet/syntax/tokens';
import { parseListOfComponentValues } from '../../../../src/stylelet/syntax/parser';
import {
  AngleLiteral, FrequencyLiteral, LengthLiteral, NumberLiteral, PercentageLiteral,
} from '../../../../src/stylelet/values/numeric-literal/index';
import { ValueStage } from '../../../../src/stylelet/value-processing/index';
import type { Value } from '../../../../src/stylelet/values/value';
import { AnglePercentageValue } from '../../../../src/stylelet/values/angle-percentage';
import { MathValue, type MathContext } from '../../../../src/stylelet/values/math-value';
import { AngleValue } from '../../../../src/stylelet/values/angle';
import { FrequencyValue } from '../../../../src/stylelet/values/frequency';
import { FrequencyPercentageValue } from '../../../../src/stylelet/values/frequency-percentage';
import { GeneralEnclosedValue } from '../../../../src/stylelet/values/general-enclosed';
import { LengthValue } from '../../../../src/stylelet/values/length';
import { LengthPercentageValue } from '../../../../src/stylelet/values/length-percentage';
import { MediaQuery } from '../../../../src/stylelet/values/media-query';
import { NumberValue } from '../../../../src/stylelet/values/number';
import { OpacityValue } from '../../../../src/stylelet/values/opacity-value';
import { PercentageValue } from '../../../../src/stylelet/values/percentage';
import { PositionValue } from '../../../../src/stylelet/values/position';
import { RatioValue } from '../../../../src/stylelet/values/ratio';
import { ResolutionValue } from '../../../../src/stylelet/values/resolution';
import { StringValue } from '../../../../src/stylelet/values/string';
import { TimeValue } from '../../../../src/stylelet/values/time';
import { TimePercentageValue } from '../../../../src/stylelet/values/time-percentage';
import { UrlValue } from '../../../../src/stylelet/values/url';
import { WholeValue } from '../../../../src/stylelet/values/whole-value';

describe('value lifecycle', () => {
  it('preserves constructor representations without promising that resolution or combination preserves them', () => {
    const number = new NumberValue(new NumberLiteral(2));
    const frequency = new FrequencyValue(new FrequencyLiteral(1, 'khz'));
    const percentage = new PercentageValue(new PercentageLiteral(25));
    const opacity = new OpacityValue(percentage);

    expectTypeOf(number).toEqualTypeOf<NumberValue<NumberLiteral>>();
    expectTypeOf(number.add(number)).toEqualTypeOf<NumberValue>();
    expectTypeOf(frequency.repr.unit).toEqualTypeOf<'khz'>();
    expectTypeOf(frequency.resolve(ValueStage.Computed)).toEqualTypeOf<FrequencyValue>();
    expectTypeOf(opacity).toEqualTypeOf<OpacityValue<PercentageValue<PercentageLiteral>>>();
    expectTypeOf(opacity.resolve(ValueStage.Computed)).toEqualTypeOf<OpacityValue>();

    expect(frequency.resolve(ValueStage.Computed).serialize()).toBe('1000hz');
    expect(opacity.resolve(ValueStage.Computed).serialize()).toBe('0.25');
    expect(frequency.repr.unit).toBe('khz');
    expect(opacity.repr).toBe(percentage);
  });

  it('keeps a math representation constrained by its numeric category', () => {
    const math = new MathValue(new LengthLiteral(2, 'em'), 'length');
    const computed = math.resolve(ValueStage.Computed, { length: { em: 16 } });

    expectTypeOf(math).toEqualTypeOf<MathValue<'length', LengthLiteral<'em'>>>();
    expectTypeOf(computed).toEqualTypeOf<MathValue<'length'>>();
    expectTypeOf<AngleLiteral>().not.toExtend<MathValue<'length'>['repr']>();
    expect(computed.serialize()).toBe('32px');
    expect(math.serialize()).toBe('2em');
  });

  it('allows a whole value to resolve beyond its original representation', () => {
    const percentage = new PercentageValue(new PercentageLiteral(50));
    const declared = new WholeValue<OpacityValue<PercentageValue>>(
      new OpacityValue(percentage),
      (input, context) => {
        const parsed = PercentageValue.parse(input, context);
        return parsed === null ? null : new OpacityValue(parsed);
      },
    );
    const computed = declared.resolve(ValueStage.Computed, {});

    expectTypeOf(computed).toExtend<WholeValue<OpacityValue>>();
    expect(computed.inner).toEqual(new OpacityValue(new NumberValue(new NumberLiteral(0.5))));
    expect(computed.serialize()).toBe('0.5');
    expect(declared.inner).toEqual(new OpacityValue(percentage));
    expect(declared.serialize()).toBe('50%');
  });

  it('retains known syntax fields and preserves their typing only for identity resolution', () => {
    const enclosed = new GeneralEnclosedValue({ type: TokenKind.FunctionBlock, name: 'future', value: undefined });
    const media = new MediaQuery({ type: 'media-type-query', mediaType: 'screen' });
    const url = new UrlValue({ notation: 'url', href: '#target', modifiers: {}, local: true });

    expectTypeOf(enclosed.resolve(ValueStage.Computed, {}).repr.name).toEqualTypeOf<string>();
    expectTypeOf(media.repr.mediaType).toEqualTypeOf<string>();
    expectTypeOf(media.resolve(ValueStage.Computed)).toEqualTypeOf<MediaQuery>();
    expectTypeOf(url.repr.local).toEqualTypeOf<true>();
    expectTypeOf(url.resolve(ValueStage.Computed)).toEqualTypeOf<UrlValue>();

    expect(enclosed.resolve(ValueStage.Computed, {})).toBe(enclosed);
    expect(media.serialize()).toBe('screen');
    expect(url.serialize()).toBe('url("#target")');
  });

  it('uses the same instance contract without retaining the invocation context', () => {
    const context: MathContext = {};
    const values = [
      AnyValue.parse('calc(1em + 2px)', context)!,
      MathValue.parse('calc(1em + 2px)', 'length', context)!,
      AnglePercentageValue.parse('calc(10deg + 25%)', context)!,
      LengthValue.parse('2em', context)!,
      StringValue.parse('"opaque"', context)!,
      RatioValue.parse('16 / 9', context)!,
      OpacityValue.parse('150%', context)!,
      PositionValue.parse('left 2em', context)!,
      MediaQuery.parse('(width >= 2em)', context)!,
    ] satisfies Value<MathContext>[];

    const pipeline: Value<MathContext>[] = values;
    expect(pipeline.map((value) => value.resolve(ValueStage.Computed, {
      length: { em: 16 },
      percentageReferenceValue: new AngleLiteral(360, 'deg'),
    }).serialize())).toEqual(['calc(1em + 2px)', '18px', '100deg', '32px', '"opaque"', '16 / 9', '1', '0% 32px', '(width >= 32px)']);
    expect(pipeline.map((value) => value.serialize()))
      .toEqual(['calc(1em + 2px)', 'calc(1em + 2px)', 'calc(25% + 10deg)', '2em', '"opaque"', '16 / 9', '1.5', 'left 2em', '(width >= 2em)']);
    expect(context).toEqual({});
  });

  it('continues resolving a math value after its expression becomes a literal', () => {
    const declared = MathValue.parse('calc(25%)', 'angle-percentage', { percentHint: 'angle' })!;
    const computed = declared.resolve(ValueStage.Computed, { percentHint: 'angle' });
    const used = computed.resolve(ValueStage.Used, {
      percentHint: 'angle',
      percentageReferenceValue: new AngleLiteral(200, 'deg'),
    });

    expect(computed).toBeInstanceOf(MathValue);
    expect(computed.repr).toEqual({ type: 'percentage', value: 25 });
    expect(used.repr).toEqual({ type: 'angle', value: 50, unit: 'deg' });
    expect(used.serialize()).toBe('50deg');
    expect(computed.serialize()).toBe('25%');
    expect(used.resolve(ValueStage.Actual, {})).toBe(used);
  });

  it('resolves a retained relative literal when its later context supplies a font size', () => {
    const computed = MathValue.parse('calc(2em)', 'length', {})!.resolve(ValueStage.Computed);
    expect(computed.serialize()).toBe('2em');
    expect(computed.resolve(ValueStage.Used, { length: { em: 12 } }).serialize()).toBe('24px');
    expect(computed.serialize()).toBe('2em');
  });

  it('keeps a numeric family usable after its calculation becomes a percentage', () => {
    const declared = LengthPercentageValue.parse('calc(25%)', {})!;
    const computed = declared.resolve(ValueStage.Computed);
    const used = computed.resolve(ValueStage.Used, {
      percentageReferenceValue: new LengthLiteral(200, 'px'),
    });

    expect(computed).toBeInstanceOf(LengthPercentageValue);
    expect(computed.serialize()).toBe('25%');
    expect(used).toBeInstanceOf(LengthPercentageValue);
    expect(used.serialize()).toBe('50px');
    expect(declared.serialize()).toBe('calc(25%)');
    expect(computed.serialize()).toBe('25%');
    expect(used.resolve(ValueStage.Actual)).toBe(used);
    expectTypeOf(used).toEqualTypeOf<LengthPercentageValue>();
  });

  it('combines resolved math values through the same methods', () => {
    const a = MathValue.parse('calc(10deg)', 'angle', {})!.resolve(ValueStage.Computed);
    const b = MathValue.parse('calc(20deg)', 'angle', {})!.resolve(ValueStage.Computed);
    expect(a.add(b).resolve(ValueStage.Computed).serialize()).toBe('30deg');
    expect(a.interpolate(b, 0.5).resolve(ValueStage.Computed).serialize()).toBe('15deg');
    expect(a.accumulate(b).resolve(ValueStage.Computed).serialize()).toBe('30deg');
  });

  it.each([
    [AngleValue, '10deg'],
    [AnglePercentageValue, '10deg'],
    [FrequencyValue, '10hz'],
    [FrequencyPercentageValue, '10hz'],
    [LengthValue, '10px'],
    [LengthPercentageValue, '10px'],
    [ResolutionValue, '1dppx'],
    [TimeValue, '1s'],
    [TimePercentageValue, '1s'],
  ])('retains %s identity for canonical %s across lifecycle stages', (factory, input) => {
    const numeric = factory.parse(input, {})!;
    expect(numeric.resolve(ValueStage.Computed)).toBe(numeric);
    expect(numeric.resolve(ValueStage.Actual)).toBe(numeric);
    expect(numeric.serialize()).toBe(input);
  });

  it('keeps the numeric grammar and concrete class in factory and resolution results', () => {
    const c = new TokenCursor(parseListOfComponentValues('calc(1px) trailing', {}), {});
    const value = MathValue.consume(c, { expectedType: 'length' })!;

    expectTypeOf(value).toEqualTypeOf<MathValue<'length'>>();
    expectTypeOf(value.resolve(ValueStage.Computed)).toEqualTypeOf<MathValue<'length'>>();
    expectTypeOf(AnglePercentageValue.parse('1deg', {})!.resolve(ValueStage.Computed))
      .toEqualTypeOf<AnglePercentageValue>();
    expectTypeOf(AnyValue.parse('a', {})!.resolve(ValueStage.Computed, {})).toEqualTypeOf<AnyValue>();
    expect(value.serialize()).toBe('calc(1px)');
    expect(c.pos()).toBe(1);
    expect(c.context).toEqual({});
  });
});
