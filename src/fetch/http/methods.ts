import { isHTTPToken } from '../../http/syntax';

/** Fetch §2.2.1 — a method matches HTTP's token production. */
export function isMethod(value: string): boolean {
  return isHTTPToken(value);
}

export function isCORSSafelistedMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD' || method === 'POST';
}

export function isForbiddenMethod(method: string): boolean {
  return ['CONNECT', 'TRACE', 'TRACK'].includes(method.toUpperCase());
}

/** Only the six legacy method spellings are normalized; e.g. patch stays patch. */
export function normalizeMethod(method: string): string {
  const upper = method.toUpperCase();
  return ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'POST', 'PUT'].includes(upper) ? upper : method;
}
