/**
 * https://fetch.spec.whatwg.org/#authentication-entries
 * Shared by origin and proxy authentication. The realm is an HTTP challenge label.
 */
export type AuthenticationEntry = {
  /** User name supplied for HTTP origin or proxy authentication. */
  username: string;
  /** Password paired with the authentication user name. */
  password: string;
  /** HTTP challenge's realm label identifying the protected area, not a JavaScript realm. */
  realm: string;
};
