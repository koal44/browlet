import {
  parseListOfComponentValues, type BlockKind, type ComponentValue, type ParserInput,
  type PreservedToken, type SimpleBlockKind,
} from '../parser/syntax';
import { TokenKind, type StaticToken } from '../parser/tokens';

export type AnyValue = [AnyValueComponent, ...AnyValueComponent[]];

export type AnyValueComponent =
  | AnyValueToken
  | { block: SimpleBlockKind; value: AnyValueContents; }
  | { block: BlockKind.Function; name: string; value: AnyValueContents; };

type AnyValueToken = Exclude<PreservedToken, InvalidAnyValueToken>;
type AnyValueContents = AnyValueComponent[];

type InvalidAnyValueToken =
  | StaticToken<TokenKind.BadString>
  | StaticToken<TokenKind.BadUrl>
  | StaticToken<TokenKind.RightParen>
  | StaticToken<TokenKind.RightBracket>
  | StaticToken<TokenKind.RightBrace>;

export function parseAnyValue(input: ParserInput): AnyValue | null {
  const components = parseListOfComponentValues(input);
  return isAnyValue(components) ? components : null;
}

export function isAnyValue(components: readonly ComponentValue[]): components is AnyValue {
  if (components.length === 0) return false;

  for (const component of components) {
    if ('kind' in component) {
      switch (component.kind) {
        case TokenKind.BadString:
        case TokenKind.BadUrl:
        case TokenKind.RightParen:
        case TokenKind.RightBracket:
        case TokenKind.RightBrace:
          return false;

        default:
          continue;
      }
    }

    if (component.value.length > 0 && !isAnyValue(component.value)) {
      return false;
    }
  }

  return true;
}
