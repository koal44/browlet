import type { PromiseValue } from '../../infra/promises';
import type { FetchRequest } from '../request';
import type { FetchResponse } from '../response';

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

/** Browser authentication state and prompting required by Fetch's HTTP transaction. */
// PROVISIONAL: the UserAgent supplies a no-credentials implementation until the
// HTTP roadmap's RFC 9110/7617 work provides challenge parsing, protection spaces,
// credential storage, and the browser's prompt/proxy integration.
export interface HTTPAuthentication {
  /** Select cached credentials, or encode URL credentials for an authentication retry. */
  getAuthorization(request: FetchRequest, isAuthenticationFetch: boolean): string | null;
  /** Apply configured proxy credentials independently of the request's credentials mode. */
  applyProxyAuthentication(request: FetchRequest): void;
  /** Handle the challenge and update URL/proxy credentials; false means the prompt was declined. */
  prompt(request: FetchRequest, response: FetchResponse): PromiseValue<boolean>;
  /** Remember a successful authentication exchange in its challenge's protection space. */
  store(request: FetchRequest, response: FetchResponse): void;
}
