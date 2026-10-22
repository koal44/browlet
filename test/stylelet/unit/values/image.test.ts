import { describe, expect, it } from 'vitest';
import { GradientValue } from '../../../../src/stylelet/values/gradient';
import { parseImage } from '../../../../src/stylelet/values/image';
import { UrlValue } from '../../../../src/stylelet/values/url';
import { ValueStage } from '../../../../src/stylelet/value-processing/stage';

describe('image values', () => {
  it('parses URL images', () => {
    expect(parseImage('url("image.png")', {})).toEqual(UrlValue.parse('url("image.png")', {}));
  });

  it.each([
    'linear-gradient(red, blue)',
    'radial-gradient(red, blue)',
    'conic-gradient(red, blue)',
  ])('parses the gradient image %j', (input) => {

    expect(parseImage(input, {})).toEqual(GradientValue.parse(input, {}));
  });

  it.each([
    '',
    'none',
    'red',
    'image.png',
    'linear-gradient()',
  ])('rejects %j', (input) => {
    expect(parseImage(input, {})).toBeNull();
  });

  it('resolves and serializes gradient images', () => {
    expect(parseImage('linear-gradient(red, blue)', {})!
      .resolve(ValueStage.Computed, {}).serialize())
      .toBe('linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255))');
  });

  it('resolves and serializes URL images', () => {
    const value = parseImage('url("image.png")', {})!;
    const resolved = value.resolve(ValueStage.Computed, {
      URL,
      baseUrl: new URL('https://example.com/styles/site.css'),
    });

    expect(resolved.serialize())
      .toBe('url("https://example.com/styles/image.png")');
  });
});
