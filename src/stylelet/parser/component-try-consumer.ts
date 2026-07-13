import type { ComponentCursor } from './component-cursor';

export type TryComponentConsumer<T> =
  (c: ComponentCursor) => TryComponentConsumerResult<T>;

/**
 * Try consumers use three channels:
 *
 *   null        = this consumer did not match this production. The consumer
 *                 must leave the cursor position and context unchanged, so
 *                 the caller may safely try another production.
 *
 *   ok(value)   = this consumer matched a valid construct. The cursor usually
 *                 advances, but nullable productions may succeed without
 *                 consuming input.
 *
 *   bad(reason) = this consumer reached a committed failure. The current
 *                 recovery unit is invalid, so the result must propagate
 *                 without trying alternatives or backtracking within that
 *                 unit. The cursor remains at the failure point; context is
 *                 restored while the failure unwinds.
 *
 * Use `bad` when returning `null` would incorrectly allow the caller to try
 * another production. A strict recovery boundary rejects its containing unit;
 * a forgiving recovery boundary may discard the failed item and resume at a
 * structurally known boundary.
 *
 * A thrown error reports an invariant or programming failure. No cursor or
 * context restoration guarantee applies to thrown errors.
 *
 * Consumers propagate `bad` unless they explicitly own such a recovery
 * boundary. Assertion boundaries may unwrap and throw if `bad` should be
 * impossible there.
 *
 * TODO: Revisit this distinction. `bad` is useful when `null` would lie about
 * a recognized invalid construct, but the older consumer code is not fully
 * migrated to that doctrine, and it may be more distinction than we need.
 */
export type TryComponentConsumerResult<T> =
  ComponentConsumerResult<T> | null;

export type ComponentConsumerResult<T> =
  | ComponentConsumerOk<T>
  | ComponentConsumerBad;

export type ComponentConsumerOk<T> = {
  kind: ComponentConsumerResultKind.Ok;
  value: T;
};

export type ComponentConsumerBad = {
  kind: ComponentConsumerResultKind.Bad;
  reason: ComponentConsumerBadReason;
  message?: string;
};

export enum ComponentConsumerResultKind {
  Ok = 'ok',
  Bad = 'bad',
}

export enum ComponentConsumerBadReason {
  Invalid = 'invalid',
  InvalidPseudoElementTail = 'invalid-pseudo-element-tail',
}

export function ok<T>(value: T): ComponentConsumerOk<T> {
  return {
    kind: ComponentConsumerResultKind.Ok,
    value,
  };
}

export function bad(
  reason: ComponentConsumerBadReason = ComponentConsumerBadReason.Invalid,
  message?: string,
): ComponentConsumerBad {
  return {
    kind: ComponentConsumerResultKind.Bad,
    reason,
    message,
  };
}

export function isOk<T>(
  result: TryComponentConsumerResult<T>,
): result is ComponentConsumerOk<T> {
  return result !== null && result.kind === ComponentConsumerResultKind.Ok;
}

export function isBad(
  result: unknown,
): result is ComponentConsumerBad {
  return (
    result !== null &&
    typeof result === 'object' &&
    'kind' in result &&
    result.kind === ComponentConsumerResultKind.Bad
  );
}

export function unwrapConsumeResultOrThrow<T>(
  result: TryComponentConsumerResult<T>,
  label: string,
): T | null {
  if (result === null) {
    return null;
  }

  if (isBad(result)) {
    throw new Error(
      [
        `Uncontained bad result while consuming ${label}: ${result.message ?? result.reason}.`,
        `Expected bad results must be handled by the nearest parser/consumer that understands the reason.`,
      ].join('\n'),
    );
  }

  return result.value;
}
