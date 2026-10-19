import {
  one, oneOf, withTrivia, createComponentParser,
  type TokenCursor, type TryConsumer, type TryConsumerResult, type ParserInput,
} from '../syntax/index';
import type { ValueStage, ValueDefinition } from '../value-processing/index';

import {
  resolveGradient, serializeGradient, consumeGradient,
  type GradientValueContext, type GradientValue,
} from './gradient';
import {
  resolveUrl, serializeUrl, consumeUrl, type UrlContext, type UrlValue,
} from './url';

/*
 * <image> = <url> | <gradient>
 */

export type ImageValue = UrlValue | GradientValue;

export type ImageValueContext = GradientValueContext & UrlContext;

export const imageDef: ValueDefinition<ImageValue, ImageValueContext> = {
  consume: consumeImage,
  resolve: resolveImage,
  serialize: serializeImage,
};

export function parseImage(
  input: ParserInput,
  context: ImageValueContext = {},
): ImageValue | null {
  return imageParser(input, context);
}

export function consumeImage(
  c: TokenCursor,
): TryConsumerResult<ImageValue> {
  return imageConsumer(c);
}

export function resolveImage(
  value: ImageValue,
  stage: ValueStage,
  context: ImageValueContext = {},
): ImageValue {
  return value.type === 'url'
    ? resolveUrl(value, stage, context)
    : resolveGradient(value, stage, context);
}

export function serializeImage(value: ImageValue): string {
  return value.type === 'url' ? serializeUrl(value) : serializeGradient(value);
}

// <image> = <url> | <gradient>
const imageConsumer: TryConsumer<ImageValue> = oneOf(
  [
    one(consumeUrl),
    one(consumeGradient),
  ],
  ([image]) => image,
);

const imageParser = createComponentParser(withTrivia(imageConsumer));
