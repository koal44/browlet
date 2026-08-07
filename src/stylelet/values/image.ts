import {
  type TokenCursor, type TryConsumer, type TryConsumerResult,
} from '../syntax/token-cursor';
import { one, oneOf, withTrivia } from '../syntax/component-grammar';
import { createComponentParser, type ParserInput } from '../syntax/parser';
import type { ValueStage } from '../value-processing/stage';
import {
  resolveGradient, serializeGradient, consumeGradient,
  type GradientContext, type GradientValue,
} from './gradient';
import { serializeUrl, consumeUrl, type UrlValue } from './url';
import type { ValueDefinition } from '../value-processing/definition';

/*
 * <image> = <url> | <gradient>
 */

export type ImageValue = UrlValue | GradientValue;

export type ImageContext = GradientContext;

export const imageDef: ValueDefinition<ImageValue, ImageContext> = {
  consume: consumeImage,
  resolve: resolveImage,
  serialize: serializeImage,
};

export function parseImage(
  input: ParserInput,
  context: ImageContext = {},
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
  context: ImageContext = {},
): ImageValue {
  return value.type === 'url' ? value : resolveGradient(value, stage, context);
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
