import type { InternalPromise } from '../../infra/promises';
import type { URLRecord } from '../../url/index';
import type { FetchController } from '../controller';
import type { FetchRequest } from '../request';
import type { FetchResponse } from '../response';

/** Credentials returned by the browser's authentication prompt. */
export type AuthenticationCredentials = {
  username: string;
  password: string;
};

// https://fetch.spec.whatwg.org/#authentication-entries
export interface AuthenticationEntry extends AuthenticationCredentials {
  /** HTTP protection-space label, not a JavaScript realm. */
  realm: string;
}

/** Browser authentication state and prompting required by Fetch's HTTP transaction. */
export interface HTTPAuthentication {
  /** Changes when credentials are cleared, preventing an older exchange from restoring them. */
  generation: number;
  /** Find a known realm, or infer one from the URL's directory scope. */
  find(url: URLRecord, realm?: string): AuthenticationEntry | null;
  /** Remove rejected credentials without removing a concurrent replacement. */
  invalidate(url: URLRecord, entry: AuthenticationEntry): void;
  /** Retain an accepted exchange, including its challenge and authenticated path. */
  store(url: URLRecord, entry: AuthenticationEntry, generation: number): void;
  /** Obtain credentials or null; cancellation settles a pending prompt. */
  prompt(
    request: FetchRequest, realm: string, previous: AuthenticationEntry | null, controller: FetchController,
  ): InternalPromise<AuthenticationEntry | null>;

  // PROVISIONAL: proxy authentication awaits a configured proxy identity and transport route.
  /** Apply configured proxy credentials independently of the request's credentials mode. */
  applyProxyAuthentication(request: FetchRequest): void;
  promptProxy(request: FetchRequest, response: FetchResponse): InternalPromise<boolean>;
}
