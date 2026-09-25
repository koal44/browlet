import { parseHTTPDate } from './date';
import { nonASCIIDigitPattern, surroundingTabOrSpacePattern } from '../infra/patterns';

// RFC 9110 §10.2.3. A delay starts at response receipt; deciding to retry is the caller's policy.
/** Parse Retry-After without scheduling a retry; now resolves obsolete two-digit years. */
export function parseRetryAfter(input: string, now: number): RetryAfter | null {
  const value = input.replace(surroundingTabOrSpacePattern, '');
  if (value !== '' && !nonASCIIDigitPattern.test(value)) {
    return { delaySeconds: BigInt(value) };
  }
  const date = parseHTTPDate(value, now);
  return date === null ? null : { date };
}

/** A parsed field supplies either an absolute UTC time in milliseconds or an exact delay in seconds. */
export type RetryAfter = {
  date?: number;
  delaySeconds?: bigint;
};
