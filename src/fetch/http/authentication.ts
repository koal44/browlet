/**
 * https://fetch.spec.whatwg.org/#authentication-entries
 * Shared by origin and proxy authentication. The realm is an HTTP challenge label.
 */
export type AuthenticationEntry = {
  username: string;
  password: string;
  realm: string;
};
