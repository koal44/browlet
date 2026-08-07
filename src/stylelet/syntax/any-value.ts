import { type TokenCursor, type TryConsumerResult } from './token-cursor';
import {
  type ComponentValue, type PreservedToken, type SimpleBlockKind, isComponentBlock,
} from './component-value';
import { parseListOfComponentValues, type ParserInput } from './parser';
import { TokenKind, type StaticToken, type Token } from './tokens';

/*
 * <any-value>
 */

export type AnyValue = {
  type: 'any-value';
  components: AnyValueComponents;
};

export type AnyValueComponents = [AnyValueComponent, ...AnyValueComponent[]];

export type AnyValueComponent =
  | AnyValueToken
  | { type: SimpleBlockKind; value: AnyValueContents; }
  | { type: TokenKind.FunctionBlock; name: string; value: AnyValueContents; };

type AnyValueToken = Exclude<PreservedToken, InvalidAnyValueToken>;
export type AnyValueContents = AnyValueComponent[];

type InvalidAnyValueToken =
  | StaticToken<TokenKind.BadString>
  | StaticToken<TokenKind.BadUrl>
  | StaticToken<TokenKind.RightParen>
  | StaticToken<TokenKind.RightBracket>
  | StaticToken<TokenKind.RightBrace>;

export function parseAnyValue(input: ParserInput): AnyValue | null {
  const components = parseListOfComponentValues(input);
  return isAnyValueComponents(components)
    ? { type: 'any-value', components }
    : null;
}

export function consumeAnyValue(
  c: TokenCursor,
): TryConsumerResult<AnyValue> {
  const first = c.peek();

  if (!isAnyValueComponent(first)) return null;

  c.next();
  const components: AnyValueComponents = [first];

  while (true) {
    const component = c.peek();

    if (!isAnyValueComponent(component)) break;

    components.push(component);
    c.next();
  }

  return { type: 'any-value', components };
}

export function isAnyValueComponents(
  components: readonly ComponentValue[],
): components is AnyValueComponents {
  return components.length > 0 && isAnyValueContents(components);
}

export function isAnyValueContents(
  components: readonly ComponentValue[],
): components is AnyValueContents {
  return components.every(isAnyValueComponent);
}

function isAnyValueComponent(
  component: Token,
): component is AnyValueComponent {
  if (isComponentBlock(component)) {
    return isAnyValueContents(component.value);
  }

  switch (component.type) {
    case TokenKind.BadString:
    case TokenKind.BadUrl:
    case TokenKind.RightParen:
    case TokenKind.RightBracket:
    case TokenKind.RightBrace:
    case TokenKind.EOF:
      return false;

    default:
      return true;
  }
}
