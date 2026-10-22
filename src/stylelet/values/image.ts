import {
  one, oneOf, withTrivia, createComponentParser,
  type ComponentValue, type TokenCursor, type TryConsumer, type TryConsumerResult, type ParserInput,
} from '../syntax/index';

import { GradientValue, type GradientValueContext } from './gradient';
import { UrlValue, type UrlContext } from './url';

/** Each image alternative already owns its lifecycle; the union adds no container. */
export type ImageValue = UrlValue | GradientValue;

export type ImageValueContext = GradientValueContext & UrlContext;

/** Parse a complete supported image notation. */
export function parseImage(
  input: ParserInput,
  context: ImageValueContext,
): ImageValue | null {
  return imageParser(input, context);
}

/** Consume a URL or gradient, retaining its concrete value. */
export function consumeImage(
  c: TokenCursor<ComponentValue, ImageValueContext>,
): TryConsumerResult<ImageValue> {
  return imageConsumer(c);
}

/*
 * Supported <image> alternatives (see ROADMAP.md for the remaining notations):
 * <image> = <url> | <gradient>
 */
const imageConsumer: TryConsumer<ImageValue, ImageValueContext> = oneOf(
  [
    one(UrlValue.consume),
    one(GradientValue.consume),
  ],
  ([image]) => image,
);

const imageParser = createComponentParser(withTrivia(imageConsumer));
