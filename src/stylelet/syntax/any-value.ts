import { type TokenCursor, type TryConsumerResult } from './token-cursor';
import {
  type ComponentValue, type PreservedToken, type SimpleBlockKind, isComponentBlock,
} from './component-value';
import { parseListOfComponentValues, type ParserInput } from './parser';
import { TokenKind, type StaticToken, type Token, type TokenList, type NonEmptyTokenList } from './tokens';

/*
 * <any-value>
 */
// https://drafts.csswg.org/css-syntax-3/#any-value

export type AnyValue = {
  type: 'any-value';
  components: AnyValueComponents;
};

export type AnyValueComponents = NonEmptyTokenList<AnyValueComponent>;

export type AnyValueComponent =
  | AnyValueToken
  | { type: SimpleBlockKind; value: AnyValueContents; }
  | { type: TokenKind.FunctionBlock; name: string; value: AnyValueContents; };

type AnyValueToken = Exclude<PreservedToken, InvalidAnyValueToken>;
export type AnyValueContents = TokenList<AnyValueComponent>;

type InvalidAnyValueToken =
  | StaticToken<TokenKind.BadString>
  | StaticToken<TokenKind.BadUrl>
  | StaticToken<TokenKind.RightParen>
  | StaticToken<TokenKind.RightBracket>
  | StaticToken<TokenKind.RightBrace>;

export function parseAnyValue(input: ParserInput, context: unknown): AnyValue | null {
  const list = parseListOfComponentValues(input, context);
  return isAnyValueComponents(list)
    ? { type: 'any-value', components: list }
    : null;
}

export function consumeAnyValue(
  c: TokenCursor,
): TryConsumerResult<AnyValue> {
  const first = c.peek();

  if (!isAnyValueComponent(first)) return null;

  const start = c.pos();
  c.next();
  const list: AnyValueComponents = {
    tokens: [first],
    text: c.source.text,
    ranges: [c.sourceRange(start, c.pos())],
  };

  while (true) {
    const component = c.peek();

    if (!isAnyValueComponent(component)) break;

    const start = c.pos();
    c.next();
    list.tokens.push(component);
    list.ranges.push(c.sourceRange(start, c.pos()));
  }

  return { type: 'any-value', components: list };
}

export function isAnyValueComponents(
  list: TokenList<ComponentValue>,
): list is AnyValueComponents {
  return list.tokens.length > 0 && isAnyValueContents(list);
}

export function isAnyValueContents(
  list: TokenList<ComponentValue>,
): list is AnyValueContents {
  return list.tokens.every(isAnyValueComponent);
}

function isAnyValueComponent(
  token: Token,
): token is AnyValueComponent {
  if (isComponentBlock(token)) {
    return isAnyValueContents(token.value);
  }

  switch (token.type) {
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
