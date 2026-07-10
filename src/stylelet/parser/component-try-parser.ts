import type { ComponentCursor } from './component-cursor';

export type TryComponentParser<T> =
  (c: ComponentCursor) => TryComponentParserResult<T>;

/**
 * Try parsers use three channels:
 *
 *   null        = this parser did not match this production; caller may try
 *                 another production after restoring the cursor.
 *
 *   ok(value)   = this parser matched and consumed a valid construct.
 *
 *   bad(reason) = this parser matched and consumed a recognized construct,
 *                 but that construct is invalid in the current context.
 *
 * Use `bad` when returning `null` would incorrectly pretend the production did
 * not match. Do not use `bad` merely because a parse failed.
 *
 * Strict boundaries usually convert bad to null. Forgiving boundaries usually
 * drop bad items. Assertion boundaries may unwrap and throw if bad should be
 * impossible there.
 *
 * TODO: Revisit this distinction. `bad` is useful when `null` would lie about
 * a recognized invalid construct, but the older parser code is not fully
 * migrated to that doctrine, and it may be more distinction than we need.
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
