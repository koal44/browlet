import type { ComponentCursor } from '../parser/component-cursor';
import { one, oneOf, withComponentTrivia } from '../parser/component-grammar';
import {
  isBad, ok,
  type TryComponentConsumer, type TryComponentConsumerResult,
} from '../parser/component-try-consumer';
import { parseAsComponentGrammar, type ParserInput } from '../parser/syntax';
import type { ValueStage } from '../value-processing';
import {
  resolveGradient, serializeGradient, tryConsumeGradient,
  type GradientContext, type GradientValue,
} from './gradient';
import { serializeUrl, tryConsumeUrl, type UrlValue } from './url';

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
    withComponentTrivia(tryConsumeImage),
    context,
  );

  return result === null || isBad(result) ? null : result.value;
}

export function tryConsumeImage(
  c: ComponentCursor,
): TryComponentConsumerResult<ImageValue> {
  return consumeImage(c);
}

// <image> = <url> | <gradient>
const consumeImage: TryComponentConsumer<ImageValue> = oneOf(
  [
    one(tryConsumeUrl),
    one(tryConsumeGradient),
  ],
  ([image]) => ok(image),
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
