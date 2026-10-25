import { styleletEnv } from '../../environment-fixture';
import { parseURL } from '../../url-fixture';
import { describe, expect, it } from 'vitest';
import { GradientValue } from '../../../../src/stylelet/values/gradient';
import { parseImage } from '../../../../src/stylelet/values/image';
import { UrlValue } from '../../../../src/stylelet/values/url';
import { ValueStage } from '../../../../src/stylelet/value-processing/stage';

describe('image values', () => {
  it('parses URL images', () => {
    expect(parseImage('url("image.png")', { env: styleletEnv })).toEqual(UrlValue.parse('url("image.png")', {}));
  });

  it.each([
    'linear-gradient(red, blue)',
    'radial-gradient(red, blue)',
    'conic-gradient(red, blue)',
  ])('parses the gradient image %j', (input) => {

    expect(parseImage(input, { env: styleletEnv })).toEqual(GradientValue.parse(input, { env: styleletEnv }));
  });

  it.each([
    '',
    'none',
    'red',
    'image.png',
    'linear-gradient()',
  ])('rejects %j', (input) => {
    expect(parseImage(input, { env: styleletEnv })).toBeNull();
  });

  it('resolves and serializes gradient images', () => {
    expect(parseImage('linear-gradient(red, blue)', { env: styleletEnv })!
      .resolve(ValueStage.Computed, { env: styleletEnv }).serialize())
      .toBe('linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255))');
  });

  it('resolves and serializes URL images', () => {
    const value = parseImage('url("image.png")', { env: styleletEnv })!;
    const resolved = value.resolve(ValueStage.Computed, {
      env: styleletEnv,
      baseUrl: parseURL('https://example.com/styles/site.css')!,
    });

    expect(resolved.serialize())
      .toBe('url("https://example.com/styles/image.png")');
  });
});
