import { describe, expect, it } from 'vitest';
import { parseGradient } from '../../../../src/stylelet/values/gradient';
import { parseImage, resolveImage, serializeImage } from '../../../../src/stylelet/values/image';
import { parseUrl } from '../../../../src/stylelet/values/url';
import { ValueStage } from '../../../../src/stylelet/value-processing/stage';

describe('image values', () => {
  it('parses URL images', () => {
    expect(parseImage('url("image.png")')).toEqual(parseUrl('url("image.png")'));
  });

  it.each([
    'linear-gradient(red, blue)',
    'radial-gradient(red, blue)',
    'conic-gradient(red, blue)',
  ])('parses the gradient image %j', (input) => {

    expect(parseImage(input)).toEqual(parseGradient(input));
  });

  it.each([
    '',
    'none',
    'red',
    'image.png',
    'linear-gradient()',
  ])('rejects %j', (input) => {
    expect(parseImage(input)).toBeNull();
  });

  it('resolves and serializes gradient images', () => {
    expect(serializeImage(resolveImage(
      parseImage('linear-gradient(red, blue)')!,
      ValueStage.Computed,
    ))).toBe('linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255))');
  });

  it('preserves and serializes URL images', () => {
    const value = parseImage('url("image.png")')!;

    expect(resolveImage(value, ValueStage.Computed)).toBe(value);
    expect(serializeImage(value)).toBe('url("image.png")');
  });
});
