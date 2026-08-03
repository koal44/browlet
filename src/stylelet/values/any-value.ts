import { type ComponentCursor, type TryComponentConsumerResult } from '../parser/component-cursor';
import { type BlockKind, type ComponentValue, type PreservedToken, type SimpleBlockKind } from '../parser/component-value';
import { parseListOfComponentValues, type ParserInput } from '../parser/syntax';
import { TokenKind, type StaticToken } from '../parser/tokens';

export type AnyValue = {
  type: 'any-value';
  components: AnyValueComponents;
};

export type AnyValueComponents = [AnyValueComponent, ...AnyValueComponent[]];

export type AnyValueComponent =
  | AnyValueToken
  | { type: 'block'; block: SimpleBlockKind; value: AnyValueContents; }
  | { type: 'block'; block: BlockKind.Function; name: string; value: AnyValueContents; };

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

// <any-value>
export function tryConsumeAnyValue(
  c: ComponentCursor,
): TryComponentConsumerResult<AnyValue> {
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
  component: ComponentValue | null,
): component is AnyValueComponent {
  if (component === null) return false;

  if (component.type === 'block') {
    return isAnyValueContents(component.value);
  }

  switch (component.kind) {
    case TokenKind.BadString:
    case TokenKind.BadUrl:
    case TokenKind.RightParen:
    case TokenKind.RightBracket:
    case TokenKind.RightBrace:
      return false;

    default:
      return true;
  }
}
