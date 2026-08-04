import { type ComponentCursor, type TryComponentConsumer, type TryComponentConsumerResult } from '../parser/component-cursor';
import { one, oneOf, withTrivia } from '../parser/component-grammar';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import type { ValueStage } from '../value-processing';
import {
  resolveGradient, serializeGradient, tryConsumeGradient,
  type GradientContext, type GradientValue,
} from './gradient';
import { serializeUrl, tryConsumeUrl, type UrlValue } from './url';
import type { ValueDefinition } from './value-definition';

/*
 * <image> = <url> | <gradient>
 */

export type ImageValue = UrlValue | GradientValue;

export type ImageContext = GradientContext;

export function parseImage(
  input: ParserInput,
  context: ImageContext = {},
): ImageValue | null {
  const result = parseAsComponentGrammar(
    input,
    withTrivia(tryConsumeImage),
    context,
  );

  return result;
}

export function tryConsumeImage(
  c: ComponentCursor,
): TryComponentConsumerResult<ImageValue> {
  return consumeImage(c);
}

export const imageDef: ValueDefinition<ImageValue, ImageContext> = {
  tryConsume: tryConsumeImage,
  resolve: resolveImage,
  serialize: serializeImage,
};

// <image> = <url> | <gradient>
const consumeImage: TryComponentConsumer<ImageValue> = oneOf(
  [
    one(tryConsumeUrl),
    one(tryConsumeGradient),
  ],
  ([image]) => image,
);

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
