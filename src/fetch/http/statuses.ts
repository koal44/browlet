/** Fetch §2.2.3 — includes internal status 0, not just HTTP response codes. */
export function isStatus(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 999;
}

export function isNullBodyStatus(status: number): boolean {
  return [101, 103, 204, 205, 304].includes(status);
}

export function isOkStatus(status: number): boolean {
  return status >= 200 && status <= 299;
}

export function isRangeStatus(status: number): boolean {
  return status === 206 || status === 416;
}

export function isRedirectStatus(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}
