/*
 * URL validation errors.
 *
 * https://url.spec.whatwg.org/#writing
 */
export type URLValidationError =
  | 'domain-to-ASCII'
  | 'domain-percent-encoded'
  | 'host-invalid-code-point'
  | 'IPv4-empty-part'
  | 'IPv4-too-few-parts'
  | 'IPv4-too-many-parts'
  | 'IPv4-non-numeric-part'
  | 'IPv4-non-decimal-part'
  | 'IPv4-out-of-range-part'
  | 'IPv4-non-ASCII-input'
  | 'IPv6-unclosed'
  | 'IPv6-invalid-compression'
  | 'IPv6-too-many-pieces'
  | 'IPv6-multiple-compression'
  | 'IPv6-invalid-code-point'
  | 'IPv6-too-few-pieces'
  | 'IPv6-piece-leading-zero'
  | 'IPv4-in-IPv6-too-many-pieces'
  | 'IPv4-in-IPv6-invalid-code-point'
  | 'IPv4-in-IPv6-out-of-range-part'
  | 'IPv4-in-IPv6-too-few-parts'
  | 'invalid-URL-unit'
  | 'special-scheme-missing-following-solidus'
  | 'missing-scheme-non-relative-URL'
  | 'invalid-reverse-solidus'
  | 'invalid-credentials'
  | 'host-missing'
  | 'port-out-of-range'
  | 'port-invalid'
  | 'file-invalid-Windows-drive-letter'
  | 'file-invalid-Windows-drive-letter-host';
