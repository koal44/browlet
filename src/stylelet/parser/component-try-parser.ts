import type { ComponentCursor } from './component-cursor';

export type TryComponentParser<T> =
  (c: ComponentCursor) => TryComponentParserResult<T>;

/**
 * Try parsers use 3 channels:
 *
 *   null        = no match; the cursor should be restored to its original position.
 *   ok(value)   = matched and consumed a valid construct.
 *   bad(reason) = matched and consumed a recognized but invalid construct.
 *
 * Generic grammar combinators propagate `bad`, while local parsers should
 * either contain it deliberately or unwrap/assert at their boundary.
 */
export type TryComponentParserResult<T> =
  ComponentParserResult<T> | null;

export type ComponentParserResult<T> =
  | ComponentParserOk<T>
  | ComponentParserBad;

export type ComponentParserOk<T> = {
  kind: ComponentParserResultKind.Ok;
  value: T;
};

export type ComponentParserBad = {
  kind: ComponentParserResultKind.Bad;
  reason: ComponentParserBadReason;
  message?: string;
};

export enum ComponentParserResultKind {
  Ok = 'ok',
  Bad = 'bad',
}

export enum ComponentParserBadReason {
  Invalid = 'invalid',
  InvalidPseudoElementTail = 'invalid-pseudo-element-tail',
}

export function ok<T>(value: T): ComponentParserOk<T> {
  return {
    kind: ComponentParserResultKind.Ok,
    value,
  };
}

export function bad(
  reason: ComponentParserBadReason = ComponentParserBadReason.Invalid,
  message?: string,
): ComponentParserBad {
  return {
    kind: ComponentParserResultKind.Bad,
    reason,
    message,
  };
}

export function isOk<T>(
  result: TryComponentParserResult<T>,
): result is ComponentParserOk<T> {
  return result !== null && result.kind === ComponentParserResultKind.Ok;
}

export function isBad(
  result: unknown,
): result is ComponentParserBad {
  return (
    result !== null &&
    typeof result === 'object' &&
    'kind' in result &&
    result.kind === ComponentParserResultKind.Bad
  );
}

export function unwrapParseResultOrThrow<T>(
  result: TryComponentParserResult<T>,
  label: string,
): T | null {
  if (result === null) {
    return null;
  }

  if (isBad(result)) {
    throw new Error(
      [
        `Uncontained bad parser result while parsing ${label}: ${result.message ?? result.reason}.`,
        `Expected bad parser results must be handled by the nearest parser that understands the reason.`,
      ].join('\n'),
    );
  }

  return result.value;
}
