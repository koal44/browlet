import { describe, expect, it } from 'vitest';
import { parseColorValue } from '../../../../src/stylelet/values/color';
import {
  interpolateGradients, isExplicitGradient, parseGradient, resolveGradient, serializeGradient,
  tryResolveExplicitGradient,
  type ConicGradient, type LinearGradient, type RadialGradient,
} from '../../../../src/stylelet/values/gradient';
import { parsePosition } from '../../../../src/stylelet/values/position';
import { ValueStage } from '../../../../src/stylelet/value-processing';

type LinearGradientStops = LinearGradient['stops'];
type LinearColorStop = Extract<LinearGradientStops[number], { type: 'color-stop'; }>;
type LinearColorHint = Extract<LinearGradientStops[number], { type: 'color-hint'; }>;
type AngularColorStopList = ConicGradient['stops'];
type AngularColorStop = Extract<AngularColorStopList[number], { type: 'color-stop'; }>;
type AngularColorHint = Extract<AngularColorStopList[number], { type: 'color-hint'; }>;
type RadialSize = RadialGradient['size'];

const length = (value: number, unit: 'px' | 'em' = 'px') => ({
  type: 'length' as const,
  value,
  unit,
});

const percentage = (value: number) => ({
  type: 'percentage' as const,
  value,
});

function stop(
  color: string,
  ...offsets: [] | NonNullable<LinearColorStop['offsets']>
): LinearColorStop {
  return {
    type: 'color-stop',
    color: parseColorValue(color)!,
    ...(offsets.length === 0 ? {} : { offsets }),
  };
}

function hint(offset: LinearColorHint['offset']): LinearColorHint {
  return { type: 'color-hint', offset };
}

function stops(...values: LinearGradientStops): LinearGradientStops {
  return values;
}

function angularStop(
  color: string,
  ...offsets: [] | NonNullable<AngularColorStop['offsets']>
): AngularColorStop {
  return {
    type: 'color-stop',
    color: parseColorValue(color)!,
    ...(offsets.length === 0 ? {} : { offsets }),
  };
}

function angularHint(offset: AngularColorHint['offset']): AngularColorHint {
  return { type: 'color-hint', offset };
}

function angularStops(...values: AngularColorStopList): AngularColorStopList {
  return values;
}

function linearGradient(
  items: LinearGradient['stops'],
  overrides: Partial<LinearGradient> = {},
): LinearGradient {
  return {
    type: 'gradient',
    gradientType: 'linear',
    repeating: false,
    direction: { type: 'angle', value: 180, unit: 'deg' },
    method: { space: 'srgb' },
    stops: items,
    ...overrides,
  };
}

function radialGradient(
  items: RadialGradient['stops'],
  overrides: Partial<RadialGradient> = {},
): RadialGradient {
  return {
    type: 'gradient',
    gradientType: 'radial',
    repeating: false,
    shape: 'ellipse',
    size: { type: 'radial-extent', extents: ['farthest-corner'] },
    position: parsePosition('center')!,
    method: { space: 'srgb' },
    stops: items,
    ...overrides,
  };
}

function conicGradient(
  items: ConicGradient['stops'],
  overrides: Partial<ConicGradient> = {},
): ConicGradient {
  return {
    type: 'gradient',
    gradientType: 'conic',
    repeating: false,
    angle: { type: 'angle', value: 0, unit: 'deg' },
    position: parsePosition('center')!,
    method: { space: 'srgb' },
    stops: items,
    ...overrides,
  };
}

describe('gradient values', () => {
  describe('<linear-gradient()>', () => {
    it('parses omitted and explicit directions', () => {
      expect(parseGradient('linear-gradient(red, blue)')).toEqual(
        linearGradient(stops(stop('red'), stop('blue'))),
      );
      expect(parseGradient('linear-gradient(45deg, red, blue)')).toEqual(linearGradient(
        stops(stop('red'), stop('blue')),
        {
          direction: { type: 'angle', value: 45, unit: 'deg' },
        },
      ));
      expect(parseGradient('linear-gradient(0, red, blue)')).toEqual(linearGradient(
        stops(stop('red'), stop('blue')),
        {
          direction: { type: 'number', value: 0 },
        },
      ));
    });

    it.each([
      ['to left', { horizontal: 'left' }],
      ['to bottom', { vertical: 'bottom' }],
      ['to right top', { horizontal: 'right', vertical: 'top' }],
      ['to top right', { horizontal: 'right', vertical: 'top' }],
    ] as const)('parses the %s direction', (input, direction) => {
      expect(parseGradient(`linear-gradient(${input}, red, blue)`)).toEqual(linearGradient(
        stops(stop('red'), stop('blue')),
        {
          direction: { type: 'side-or-corner', ...direction },
        },
      ));
    });

    it('parses color stops and transition hints', () => {
      expect(parseGradient(
        'linear-gradient(red 10px, 25%, blue 80%, green)',
      )).toEqual(linearGradient(stops(
        stop('red', length(10)),
        hint(percentage(25)),
        stop('blue', percentage(80)),
        stop('green'),
      )));
    });

    it('parses dual-position color stops', () => {
      expect(parseGradient(
        'linear-gradient(red 10% 30%, 50%, blue 70% 90%)',
      )).toEqual(linearGradient(stops(
        stop('red', percentage(10), percentage(30)),
        hint(percentage(50)),
        stop('blue', percentage(70), percentage(90)),
      )));
    });

    it('parses interpolation methods on either side of the direction', () => {
      const expected = linearGradient(stops(stop('red'), stop('blue')), {
        direction: {
          type: 'side-or-corner' as const,
          horizontal: 'right' as const,
        },
        method: { space: 'oklch' as const, hue: 'longer' as const },
      });

      expect(parseGradient(
        'linear-gradient(to right in oklch longer hue, red, blue)',
      )).toEqual(expected);
      expect(parseGradient(
        'linear-gradient(in oklch longer hue to right, red, blue)',
      )).toEqual(expected);
    });

    it('accepts a single color stop', () => {
      expect(parseGradient('linear-gradient(red)')).toEqual(
        linearGradient(stops(stop('red'))),
      );
    });

    it('supports at most 2,048 color stops', () => {
      const colors = Array.from({ length: 2_048 }, (_, index) =>
        index % 2 === 0 ? 'red' : 'blue');

      expect(parseGradient(`linear-gradient(${colors.join(', ')})`)?.stops)
        .toHaveLength(colors.length);
      expect(parseGradient(`linear-gradient(${[...colors, 'red'].join(', ')})`))
        .toBeNull();
    });
  });

  describe('<radial-gradient()>', () => {
    it('parses an omitted prelude and a position-only prelude', () => {
      expect(parseGradient('radial-gradient(red, blue)')).toEqual(
        radialGradient(stops(stop('red'), stop('blue'))),
      );
      expect(parseGradient('radial-gradient(at left top, red, blue)')).toEqual(radialGradient(
        stops(stop('red'), stop('blue')),
        {
          position: parsePosition('left top')!,
        },
      ));
      expect(parseGradient(
        'radial-gradient(at right 30% top 60px, red, blue)',
      )).toEqual(radialGradient(stops(stop('red'), stop('blue')), {
        position: parsePosition('right 30% top 60px')!,
      }));
    });

    it.each<[string, RadialSize]>([
      ['closest-side', { type: 'radial-extent', extents: ['closest-side'] }],
      [
        'closest-side farthest-corner',
        {
          type: 'radial-extent',
          extents: ['closest-side', 'farthest-corner'],
        },
      ],
      ['10px', { type: 'radial-radii', radii: [length(10)] }],
      [
        '10px 20%',
        { type: 'radial-radii', radii: [length(10), percentage(20)] },
      ],
    ])('parses the %s radial size', (input, size) => {
      expect(parseGradient(`radial-gradient(${input}, red, blue)`)).toEqual(radialGradient(
        stops(stop('red'), stop('blue')),
        {
          shape: size.type === 'radial-radii' &&
            size.radii.length === 1 &&
            size.radii[0].type === 'length'
            ? 'circle'
            : 'ellipse',
          size: size,
        },
      ));
    });

    it.each([
      [
        'circle 10px at left top',
        'circle',
        { type: 'radial-radii', radii: [length(10)] },
      ],
      [
        '10px circle at left top',
        'circle',
        { type: 'radial-radii', radii: [length(10)] },
      ],
      [
        'ellipse 10px 20% at left top',
        'ellipse',
        { type: 'radial-radii', radii: [length(10), percentage(20)] },
      ],
      [
        'farthest-corner ellipse at left top',
        'ellipse',
        { type: 'radial-extent', extents: ['farthest-corner'] },
      ],
    ] as const)('parses the %s radial prelude', (input, shape, size) => {
      expect(parseGradient(`radial-gradient(${input}, red, blue)`)).toEqual(radialGradient(
        stops(stop('red'), stop('blue')),
        {
          shape,
          size: size as RadialSize,
          position: parsePosition('left top')!,
        },
      ));
    });

    it('accepts the Images 4 one-radius ellipse and percentage circle sizes', () => {
      expect(parseGradient('radial-gradient(ellipse 10px, red, blue)')).toEqual(radialGradient(
        stops(stop('red'), stop('blue')),
        {
          shape: 'ellipse',
          size: { type: 'radial-radii', radii: [length(10)] },
        },
      ));
      expect(parseGradient('radial-gradient(circle 10%, red, blue)')).toEqual(radialGradient(
        stops(stop('red'), stop('blue')),
        {
          shape: 'circle',
          size: { type: 'radial-radii', radii: [percentage(10)] },
        },
      ));
    });

    it('parses interpolation methods on either side of radial geometry', () => {
      const expected = radialGradient(stops(stop('red'), stop('blue')), {
        shape: 'circle' as const,
        position: parsePosition('left top')!,
        method: { space: 'srgb-linear' as const },
      });

      expect(parseGradient(
        'radial-gradient(circle at left top in srgb-linear, red, blue)',
      )).toEqual(expected);
      expect(parseGradient(
        'radial-gradient(in srgb-linear circle at left top, red, blue)',
      )).toEqual(expected);
    });
  });

  describe('<conic-gradient()>', () => {
    it('parses omitted and explicit geometry', () => {
      expect(parseGradient('conic-gradient(red, blue)')).toEqual(
        conicGradient(angularStops(angularStop('red'), angularStop('blue'))),
      );
      expect(parseGradient(
        'conic-gradient(from 45deg at left top, red, blue)',
      )).toEqual(conicGradient(
        angularStops(angularStop('red'), angularStop('blue')),
        {
          angle: { type: 'angle', value: 45, unit: 'deg' },
          position: parsePosition('left top')!,
        },
      ));
    });

    it('parses angular stops, hints, and dual offsets', () => {
      expect(parseGradient(
        'conic-gradient(red 0 90deg, 25%, blue 75% 1turn)',
      )).toEqual(conicGradient(angularStops(
        angularStop(
          'red',
          { type: 'number', value: 0 },
          { type: 'angle', value: 90, unit: 'deg' },
        ),
        angularHint(percentage(25)),
        angularStop(
          'blue',
          percentage(75),
          { type: 'angle', value: 1, unit: 'turn' },
        ),
      )));
    });

    it('accepts angle-percentage calculations in angular stops', () => {
      const gradient = parseGradient(
        'conic-gradient(red calc(90deg + 50%), blue)',
      );

      expect(gradient).not.toBeNull();
      expect(gradient?.gradientType).toBe('conic');
      expect(gradient?.stops[0]?.type).toBe('color-stop');
      expect(gradient?.stops[0]?.offsets?.[0].type).toBe('math');
    });

    it('parses interpolation methods on either side of conic geometry', () => {
      const expected = conicGradient(
        angularStops(angularStop('red'), angularStop('blue')),
        {
          angle: { type: 'angle' as const, value: 30, unit: 'deg' as const },
          method: { space: 'hsl' as const, hue: 'increasing' as const },
        },
      );

      expect(parseGradient(
        'conic-gradient(from 30deg in hsl increasing hue, red, blue)',
      )).toEqual(expected);
      expect(parseGradient(
        'conic-gradient(in hsl increasing hue from 30deg, red, blue)',
      )).toEqual(expected);
    });
  });

  it.each([
    ['linear-gradient', 'linear'],
    ['radial-gradient', 'radial'],
    ['conic-gradient', 'conic'],
  ] as const)('parses an interpolation-only %s prelude', (notation, gradientType) => {
    expect(parseGradient(`${notation}(in lab, red, blue)`)).toMatchObject({
      type: 'gradient',
      gradientType,
      repeating: false,
      method: { space: 'lab' },
    });
  });

  it('represents repeating gradients with the same structural types', () => {
    expect(parseGradient('repeating-linear-gradient(red, blue)')).toEqual(
      linearGradient(stops(stop('red'), stop('blue')), { repeating: true }),
    );
    expect(parseGradient('repeating-radial-gradient(circle, red, blue)')).toEqual(
      radialGradient(stops(stop('red'), stop('blue')), {
        repeating: true,
        shape: 'circle',
      }),
    );
    expect(parseGradient('repeating-conic-gradient(red, blue)')).toEqual(
      conicGradient(
        angularStops(angularStop('red'), angularStop('blue')),
        { repeating: true },
      ),
    );
  });

  it.each([
    '',
    'linear-gradient()',
    'linear-gradient(to center, red, blue)',
    'linear-gradient(to left right, red, blue)',
    'linear-gradient(10, red, blue)',
    'linear-gradient(red 10% 20% 30%, blue)',
    'linear-gradient(red 10deg, blue)',
    'linear-gradient(in, red, blue)',
    'linear-gradient(to right in hsl increasing, red, blue)',
    'linear-gradient(red, 20%)',
    'linear-gradient(20%, red)',
    'linear-gradient(red, 20%, 30%, blue)',
    'radial-gradient()',
    'radial-gradient(circle 10px 20px, red, blue)',
    'radial-gradient(circle closest-side farthest-side, red, blue)',
    'radial-gradient(-10px, red, blue)',
    'radial-gradient(at left 4px top, red, blue)',
    'radial-gradient(at center)',
    'conic-gradient()',
    'conic-gradient(from 25%, red, blue)',
    'conic-gradient(from calc(30deg + 50%), red, blue)',
    'conic-gradient(at left from 30deg, red, blue)',
    'conic-gradient(red 10px, blue)',
    'conic-gradient(red calc(50% + 0), blue)',
    'conic-gradient(red 10deg 20deg 30deg, blue)',
    'conic-gradient(red, 10deg)',
    'conic-gradient(10deg, red)',
  ])('rejects %j', (input) => {
    expect(parseGradient(input)).toBeNull();
  });
});

describe('gradient resolution', () => {
  const squareGradientContext = {
    gradientBoxSize: { width: 100, height: 100 },
  };
  const computed = (input: string) => serializeGradient(resolveGradient(
    parseGradient(input)!,
    ValueStage.Computed,
  ));
  const usedStopOffsets = (
    input: string,
    context: Parameters<typeof resolveGradient>[2] = {},
  ) => resolveGradient(
    parseGradient(input)!,
    ValueStage.Used,
    context,
  ).stops.map((stop) => stop.type === 'color-hint'
    ? stop.offset
    : stop.offsets);

  it('narrows gradients only after explicit stop fixup is complete', () => {
    const value = parseGradient('linear-gradient(red, white, blue)')!;

    expect(tryResolveExplicitGradient(
      value,
      ValueStage.Computed,
      squareGradientContext,
    )).toBeNull();
    const explicit = tryResolveExplicitGradient(
      value,
      ValueStage.Used,
      squareGradientContext,
    );

    expect(explicit).not.toBeNull();
    expect(isExplicitGradient(explicit!)).toBe(true);
    expect(explicit!.stops.map((stop) =>
      stop.type === 'color-hint' ? stop.offset : stop.offsets,
    )).toEqual([
      [percentage(0)],
      [percentage(50)],
      [percentage(100)],
    ]);
  });

  it('makes the complete gradient geometry explicit', () => {
    const gradientBoxSize = { width: 200, height: 100 };
    const linear = tryResolveExplicitGradient(
      parseGradient('linear-gradient(to top right, red, blue)')!,
      ValueStage.Used,
      { gradientBoxSize },
    )!;
    const radial = tryResolveExplicitGradient(
      parseGradient('radial-gradient(circle farthest-side at 25% 25%, red, blue)')!,
      ValueStage.Used,
      { gradientBoxSize },
    )!;
    const conic = tryResolveExplicitGradient(
      parseGradient('conic-gradient(from .25turn at 25% 75%, red, blue)')!,
      ValueStage.Used,
      { gradientBoxSize },
    )!;

    expect(linear).toMatchObject({
      gradientType: 'linear',
      direction: {
        type: 'angle',
        value: Math.atan2(100, 200) * 180 / Math.PI,
        unit: 'deg',
      },
      lineLength: length(2 * 200 * 100 / Math.sqrt(200 ** 2 + 100 ** 2)),
    });
    expect(radial).toMatchObject({
      gradientType: 'radial',
      shape: 'ellipse',
      size: {
        type: 'radial-radii',
        radii: [length(150), length(150)],
      },
      position: {
        offsets: [percentage(25), percentage(25)],
      },
    });
    expect(conic).toMatchObject({
      gradientType: 'conic',
      angle: { type: 'angle', value: 90, unit: 'deg' },
      position: {
        offsets: [percentage(25), percentage(75)],
      },
    });
    expect([linear, radial, conic].every(isExplicitGradient)).toBe(true);
  });

  it('does not mistake double-position stops for explicit stops', () => {
    expect(isExplicitGradient(parseGradient(
      'linear-gradient(red 0px 20px, blue 100px)',
    )!)).toBe(false);
  });

  it('retains explicitly authored defaults in the resolved value', () => {
    expect(resolveGradient(
      parseGradient('linear-gradient(to bottom in srgb, red, blue)')!,
      ValueStage.Computed,
    )).toMatchObject({
      direction: { type: 'side-or-corner', vertical: 'bottom' },
      method: { space: 'srgb' },
    });
    expect(resolveGradient(
      parseGradient('radial-gradient(ellipse farthest-corner at center, red, blue)')!,
      ValueStage.Computed,
    )).toMatchObject({
      shape: 'ellipse',
      size: { type: 'radial-extent', extents: ['farthest-corner'] },
      position: { offsets: [percentage(50), percentage(50)] },
    });
    expect(resolveGradient(
      parseGradient('conic-gradient(from 0deg at center, red, blue)')!,
      ValueStage.Computed,
    )).toMatchObject({
      angle: { type: 'angle', value: 0, unit: 'deg' },
      position: { offsets: [percentage(50), percentage(50)] },
    });
  });

  it('retains omitted endpoint stop offsets at the computed stage', () => {
    const resolved = resolveGradient(
      parseGradient('linear-gradient(red, 25%, blue)')!,
      ValueStage.Computed,
    );
    const first = resolved.stops[0];
    const last = resolved.stops.at(-1)!;

    expect(first.offsets).toBeUndefined();
    expect(resolved.stops[1]).toEqual({
      type: 'color-hint',
      offset: percentage(25),
    });
    expect(last.type).toBe('color-stop');
    expect(last.type === 'color-stop' ? last.offsets : undefined)
      .toBeUndefined();
    expect(serializeGradient(resolved)).toBe(
      'linear-gradient(rgb(255, 0, 0), 25%, rgb(0, 0, 255))',
    );
  });

  it('computes authored stop offsets before used-value fixup', () => {
    const [first] = resolveGradient(
      parseGradient('linear-gradient(red 1in, blue)')!,
      ValueStage.Computed,
    ).stops;

    expect(first.offsets).toEqual([length(96)]);
  });

  it('materializes omitted endpoint stop offsets after the computed stage', () => {
    const resolved = resolveGradient(
      parseGradient('linear-gradient(red, 25%, blue)')!,
      ValueStage.Used,
      squareGradientContext,
    );
    const first = resolved.stops[0];
    const last = resolved.stops.at(-1)!;

    expect(first.offsets).toEqual([length(0)]);
    expect(last.type === 'color-stop' ? last.offsets : undefined)
      .toEqual([length(100)]);
  });

  it('only applies the first endpoint default to a single-stop gradient', () => {
    const [only] = resolveGradient(
      parseGradient('linear-gradient(red)')!,
      ValueStage.Used,
    ).stops;

    expect(only.offsets).toEqual([length(0)]);
  });

  it('distributes runs of omitted color-stop offsets', () => {
    expect(usedStopOffsets(
      'linear-gradient(red 40%, white, black, blue)',
      squareGradientContext,
    )).toEqual([
      [length(40)],
      [length(60)],
      [length(80)],
      [length(100)],
    ]);
  });

  it('moves decreasing stop offsets forward', () => {
    expect(usedStopOffsets(
      'linear-gradient(red 20px, white 0px, blue 40px)',
    )).toEqual([
      [length(20)],
      [length(20)],
      [length(40)],
    ]);
  });

  it('fixes endpoint, decreasing, and omitted offsets in order', () => {
    expect(usedStopOffsets(
      'linear-gradient(red, white -50%, black 150%, blue)',
      squareGradientContext,
    )).toEqual([
      [length(0)],
      [length(0)],
      [length(150)],
      [length(150)],
    ]);
    expect(usedStopOffsets(
      'linear-gradient(red 80px, white 0px, black, blue 100px)',
    )).toEqual([
      [length(80)],
      [length(80)],
      [length(90)],
      [length(100)],
    ]);
  });

  it('includes hints and both offsets of a color stop in fixup', () => {
    expect(usedStopOffsets(
      'linear-gradient(red 80px 20px, 10px, white, blue 100px)',
    )).toEqual([
      [length(80)],
      [length(80)],
      length(80),
      [length(90)],
      [length(100)],
    ]);
  });

  it('derives the gradient-line length from the gradient box', () => {
    const input = 'linear-gradient(yellow 100px, blue 50%)';

    expect(usedStopOffsets(input, {
      gradientBoxSize: { width: 200, height: 300 },
    })).toEqual([
      [length(100)],
      [length(150)],
    ]);
    expect(usedStopOffsets(input, {
      gradientBoxSize: { width: 200, height: 150 },
    })).toEqual([
      [length(100)],
      [length(100)],
    ]);

    expect(usedStopOffsets(
      'linear-gradient(90deg, yellow 100px, blue 50%)',
      { gradientBoxSize: { width: 300, height: 150 } },
    )).toEqual([
      [length(100)],
      [length(150)],
    ]);

    expect(usedStopOffsets(
      'linear-gradient(to top right, yellow 100px, blue 50%)',
      { gradientBoxSize: { width: 400, height: 300 } },
    )).toEqual([
      [length(100)],
      [length(240)],
    ]);
  });

  it('derives radial gradient-line lengths from explicit radii', () => {
    expect(usedStopOffsets(
      'radial-gradient(circle 200px, red 50%, blue)',
      { gradientBoxSize: { width: 300, height: 400 } },
    )).toEqual([
      [length(100)],
      [length(200)],
    ]);
    expect(usedStopOffsets(
      'radial-gradient(circle 200px, red 100px, blue 25%)',
      { gradientBoxSize: { width: 300, height: 400 } },
    )).toEqual([
      [length(100)],
      [length(100)],
    ]);
    expect(usedStopOffsets(
      'radial-gradient(ellipse 50% 25%, red 50%, blue)',
      { gradientBoxSize: { width: 200, height: 100 } },
    )).toEqual([
      [length(50)],
      [length(100)],
    ]);

    const circle = usedStopOffsets(
      'radial-gradient(circle 50%, red, blue)',
      { gradientBoxSize: { width: 300, height: 400 } },
    );

    expect(circle[1]).toEqual([{
      type: 'length',
      value: Math.hypot(300, 400) / Math.SQRT2 / 2,
      unit: 'px',
    }]);
  });

  it('derives radial gradient-line lengths from side extents', () => {
    const gradientBoxSize = { width: 200, height: 100 };

    expect(usedStopOffsets(
      'radial-gradient(ellipse closest-side at 50px 25px, red, blue)',
      { gradientBoxSize },
    )).toEqual([
      [length(0)],
      [length(50)],
    ]);
    expect(usedStopOffsets(
      'radial-gradient(circle closest-side at 50px 25px, red, blue)',
      { gradientBoxSize },
    )).toEqual([
      [length(0)],
      [length(25)],
    ]);
    expect(usedStopOffsets(
      'radial-gradient(ellipse farthest-side closest-side at 50px 25px, red, blue)',
      { gradientBoxSize },
    )).toEqual([
      [length(0)],
      [length(150)],
    ]);
  });

  it('scales corner ellipses while preserving their side-extent aspect ratio', () => {
    const gradientBoxSize = { width: 200, height: 100 };
    const closest = usedStopOffsets(
      'radial-gradient(ellipse closest-corner at 50px 25px, red, blue)',
      { gradientBoxSize },
    );

    expect(closest[1]).toEqual([length(50 * Math.SQRT2)]);
    expect(usedStopOffsets(
      'radial-gradient(ellipse farthest-corner at 50px 25px, red, blue)',
      { gradientBoxSize },
    )[1]).toEqual([length(150 * Math.SQRT2)]);
    expect(usedStopOffsets(
      'radial-gradient(red, blue)',
      { gradientBoxSize },
    )[1]).toEqual([length(100 * Math.SQRT2)]);
    expect(usedStopOffsets(
      'radial-gradient(circle closest-corner at 50px 25px, red, blue)',
      { gradientBoxSize },
    )[1]).toEqual([length(Math.hypot(50, 25))]);
    expect(usedStopOffsets(
      'radial-gradient(circle farthest-corner at 50px 25px, red, blue)',
      { gradientBoxSize },
    )[1]).toEqual([length(Math.hypot(150, 75))]);
  });

  it('does not manufacture a numeric line length for degenerate radials', () => {
    expect(tryResolveExplicitGradient(
      parseGradient('radial-gradient(closest-side at left center, red, blue)')!,
      ValueStage.Used,
      { gradientBoxSize: { width: 200, height: 100 } },
    )).toBeNull();
  });

  it('uses one turn as the intrinsic basis for conic stop offsets', () => {
    expect(usedStopOffsets(
      'conic-gradient(red 180deg, white, blue 25%)',
    )).toEqual([
      [{ type: 'angle', value: 180, unit: 'deg' }],
      [{ type: 'angle', value: 180, unit: 'deg' }],
      [{ type: 'angle', value: 180, unit: 'deg' }],
    ]);
  });

  it.each([
    'linear-gradient(red 0%, blue 100%)',
    'linear-gradient(red 0px, blue 100%)',
    'conic-gradient(red 0deg, blue 100%)',
  ])('retains but does not serialize explicit endpoint defaults in %s', (input) => {
    const resolved = resolveGradient(
      parseGradient(input)!,
      ValueStage.Computed,
    );
    const first = resolved.stops[0];
    const last = resolved.stops.at(-1)!;

    expect(first.offsets).toHaveLength(1);
    expect(last.type === 'color-stop' ? last.offsets : undefined).toHaveLength(1);
    expect(serializeGradient(resolved)).not.toMatch(/(?:0%|0px|0deg|100%)/);
  });

  it('retains both offsets of endpoint double-position stops', () => {
    const resolved = resolveGradient(
      parseGradient('linear-gradient(red 0% 20%, blue 80% 100%)')!,
      ValueStage.Computed,
    ).stops;
    const first = resolved[0];
    const last = resolved.at(-1)!;

    expect(first.offsets).toEqual([percentage(0), percentage(20)]);
    expect(last.type === 'color-stop' ? last.offsets : undefined)
      .toEqual([percentage(80), percentage(100)]);
  });

  it('resolves the colors and offsets in a gradient', () => {
    expect(computed(
      'radial-gradient(at bottom 10% right 20%, red 10%, 25%, blue 90%)',
    )).toBe(
      'radial-gradient(at 80% 90%, rgb(255, 0, 0) 10%, 25%, rgb(0, 0, 255) 90%)',
    );
  });

  it('resolves conic geometry and angular stops', () => {
    expect(computed(
      'conic-gradient(from 30deg at left, red 10deg, 25%, blue 75%)',
    )).toBe(
      'conic-gradient(from 30deg at 0% 50%, rgb(255, 0, 0) 10deg, 25%, rgb(0, 0, 255) 75%)',
    );
  });

  it.each([
    ['linear-gradient(in srgb, red, blue)', 'linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255))'],
    [
      'linear-gradient(in oklab, red, blue)',
      'linear-gradient(in oklab, rgb(255, 0, 0), rgb(0, 0, 255))',
    ],
    [
      'linear-gradient(in oklab, color(srgb 1 0 0), blue)',
      'linear-gradient(color(srgb 1 0 0), rgb(0, 0, 255))',
    ],
    [
      'linear-gradient(color(srgb 1 0 0), blue)',
      'linear-gradient(color(srgb 1 0 0), rgb(0, 0, 255))',
    ],
    [
      'linear-gradient(in srgb, color(srgb 1 0 0), blue)',
      'linear-gradient(in srgb, color(srgb 1 0 0), rgb(0, 0, 255))',
    ],
  ])('serializes the effective interpolation method in %s', (input, expected) => {
    expect(computed(input)).toBe(expected);
  });

  it.each([
    [
      'linear-gradient(to bottom, red, blue)',
      'linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255))',
    ],
    [
      'radial-gradient(ellipse farthest-corner at center, red, blue)',
      'radial-gradient(rgb(255, 0, 0), rgb(0, 0, 255))',
    ],
    [
      'radial-gradient(farthest-corner farthest-corner, red, blue)',
      'radial-gradient(farthest-corner farthest-corner, rgb(255, 0, 0), rgb(0, 0, 255))',
    ],
    [
      'radial-gradient(circle 10px at center, red, blue)',
      'radial-gradient(10px, rgb(255, 0, 0), rgb(0, 0, 255))',
    ],
    [
      'radial-gradient(ellipse 50% at center, red, blue)',
      'radial-gradient(50%, rgb(255, 0, 0), rgb(0, 0, 255))',
    ],
    [
      'radial-gradient(circle 50% at center, red, blue)',
      'radial-gradient(circle 50%, rgb(255, 0, 0), rgb(0, 0, 255))',
    ],
    [
      'radial-gradient(circle farthest-corner at center, red, blue)',
      'radial-gradient(circle, rgb(255, 0, 0), rgb(0, 0, 255))',
    ],
    [
      'conic-gradient(from 0deg at center, red, blue)',
      'conic-gradient(rgb(255, 0, 0), rgb(0, 0, 255))',
    ],
  ])('omits authored defaults when serializing the computed %s', (input, expected) => {
    expect(computed(input)).toBe(expected);
  });
});

describe('gradient serialization', () => {
  it.each([
    [
      'linear-gradient(to right in hsl longer hue, red 10% 20%, 30%, blue)',
      'linear-gradient(to right in hsl longer hue, red 10% 20%, 30%, blue)',
    ],
    [
      'radial-gradient(in lab circle 10px at left, red, blue)',
      'radial-gradient(10px at left center in lab, red, blue)',
    ],
    [
      'repeating-conic-gradient(in oklch decreasing hue from 0 at top, red, blue)',
      'repeating-conic-gradient(at center top in oklch decreasing hue, red, blue)',
    ],
  ])('serializes %s as %s', (input, expected) => {
    expect(serializeGradient(parseGradient(input)!)).toBe(expected);
  });
});

describe('gradient interpolation', () => {
  const gradientBoxSize = { width: 200, height: 100 };
  const interpolate = (a: string, b: string, progress: number) =>
    interpolateGradients(
      parseGradient(a)!,
      parseGradient(b)!,
      progress,
      { gradientBoxSize },
    );

  it('interpolates linear direction, line length, and percentage stops independently', () => {
    const result = interpolate(
      'linear-gradient(0deg, red 0%, blue 100%)',
      'linear-gradient(90deg, red 20%, blue 80%)',
      0.25,
    );

    expect(result).toMatchObject({
      gradientType: 'linear',
      direction: { type: 'angle', value: 22.5, unit: 'deg' },
      lineLength: length(100 + 0.25 * (200 - 100)),
      stops: [
        { offsets: [percentage(5)] },
        { offsets: [percentage(95)] },
      ],
    });
    expect(serializeGradient(result)).toBe(
      'linear-gradient(22.5deg, rgb(255, 0, 0) 5%, rgb(0, 0, 255) 95%)',
    );
  });

  it('takes the shorter keyword-direction path across zero degrees', () => {
    const result = interpolate(
      'linear-gradient(to left, red, blue)',
      'linear-gradient(to top, red, blue)',
      0.5,
    );

    expect(result).toMatchObject({
      gradientType: 'linear',
      direction: { type: 'angle', value: 315, unit: 'deg' },
    });
  });

  it('interpolates stop colors and transition hints', () => {
    const result = interpolate(
      'linear-gradient(red 0%, 25%, blue 100%)',
      'linear-gradient(white 0%, 75%, black 100%)',
      0.5,
    );
    const serialized = serializeGradient(result);

    expect(result.stops[1]).toEqual({
      type: 'color-hint',
      offset: percentage(50),
    });
    expect(serialized).toContain(', 50%,');
    expect(serialized).not.toContain('rgb(255, 0, 0)');
    expect(serialized).not.toContain('rgb(255, 255, 255)');
  });

  it('expands double-position stops before matching color stops', () => {
    const result = interpolate(
      'linear-gradient(red 0% 20%, blue 100%)',
      'linear-gradient(red 10%, white 50%, blue 90%)',
      0.5,
    );

    expect(result.stops).toHaveLength(3);
    expect(result.stops.map((stop) => stop.type === 'color-stop'
      ? stop.offsets[0]
      : stop.offset)).toEqual([
      percentage(5),
      percentage(35),
      percentage(95),
    ]);
  });

  it('uses the gradient color interpolation method for stop colors', () => {
    const result = interpolate(
      'linear-gradient(in hsl, red, blue)',
      'linear-gradient(in hsl, blue, red)',
      0.25,
    );

    expect(result.method.space).toBe('hsl');
    expect(result.stops[0].color.space.name).toBe('hsl');
    expect(serializeGradient(result)).toContain('in hsl');
  });

  it('interpolates explicit radial geometry', () => {
    const result = interpolate(
      'radial-gradient(ellipse 20px 40px at 20% 30%, red 0%, blue 100%)',
      'radial-gradient(ellipse 60px 80px at 80% 70%, red 20%, blue 80%)',
      0.25,
    );

    expect(result).toMatchObject({
      gradientType: 'radial',
      shape: 'ellipse',
      size: {
        type: 'radial-radii',
        radii: [length(30), length(50)],
      },
      position: {
        offsets: [percentage(35), percentage(40)],
      },
      stops: [
        { offsets: [percentage(5)] },
        { offsets: [percentage(95)] },
      ],
    });
    expect(serializeGradient(result)).toBe(
      'radial-gradient(30px 50px at 35% 40%, rgb(255, 0, 0) 5%, rgb(0, 0, 255) 95%)',
    );
  });

  it('interpolates explicit conic geometry', () => {
    const result = interpolate(
      'conic-gradient(from 0deg at 0px 0px, red 0deg, blue 360deg)',
      'conic-gradient(from 180deg at 100px 100px, white 90deg, black 270deg)',
      0.5,
    );

    expect(result).toMatchObject({
      gradientType: 'conic',
      angle: { type: 'angle', value: 90, unit: 'deg' },
      position: {
        offsets: [length(50), length(50)],
      },
      stops: [
        { offsets: [{ type: 'angle', value: 45, unit: 'deg' }] },
        { offsets: [{ type: 'angle', value: 315, unit: 'deg' }] },
      ],
    });
  });

  it('transitions mixed length and percentage stops discretely', () => {
    const a = 'linear-gradient(red 0px, blue 100%)';
    const b = 'linear-gradient(white 0px, black 100%)';

    expect(serializeGradient(interpolate(a, b, 0.49))).toBe(
      'linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255) 100px)',
    );
    expect(serializeGradient(interpolate(a, b, 0.5))).toBe(
      'linear-gradient(rgb(255, 255, 255), rgb(0, 0, 0) 100px)',
    );
  });

  it('marks the image-level cross-fade branches', () => {
    expect(() => interpolate(
      'linear-gradient(red, blue)',
      'radial-gradient(red, blue)',
      0.5,
    )).toThrow('Gradient interpolation requires cross-fade()');
    expect(() => interpolate(
      'linear-gradient(red, blue)',
      'linear-gradient(red, white, blue)',
      0.5,
    )).toThrow('Gradient interpolation requires cross-fade()');
  });
});
