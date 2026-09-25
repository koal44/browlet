import type {
  AuthenticationCredentials, AuthenticationEntry, HTTPAuthentication, FetchController, FetchPromptTarget, FetchRequest,
} from '../../fetch/index';
import { obtainURLOrigin, serializeOrigin, serializeURLPath, stripURLForReporting, type URLRecord } from '../../url/index';
import { encodeBasicCredentials } from '../../http/index';
import { InternalError } from '../../infra/internal-error';
import type { InternalPromise } from '../../infra/promises';
import type { UserAgent } from '../user-agent';

/** Session credentials and authentication prompts owned by one user agent. */
export class HTTPAuthenticationStore implements HTTPAuthentication {
  /** The host may answer asynchronously; null declines the challenge. */
  onPrompt: AuthenticationPrompt = () => null;
  #userAgent: UserAgent;
  #origins = new Map<string, Map<string, CachedCredentials>>();
  #generation = 0;

  constructor(userAgent: UserAgent) {
    this.#userAgent = userAgent;
  }

  get generation(): number { return this.#generation; }

  // RFC 9110 §11.5; RFC 7617 §2.2.
  find(url: URLRecord, realm?: string): AuthenticationEntry | null {
    const entries = this.#origins.get(serializeOrigin(obtainURLOrigin(url)));
    if (!entries) return null;
    if (realm !== undefined) return entries.get(realm)?.entry ?? null;
    const path = serializeURLPath(url);
    let match: AuthenticationEntry | null = null;
    let length = 0;
    // SPEC_CLASH(basic-scope-selection): prefer the closest directory like Chromium/WebKit; Gecko takes its first match.
    // Entries iterate in authentication order, so the most recent wins equal depths.
    for (const { entry, paths } of entries.values()) {
      for (const scope of paths) {
        if (scope.length >= length && path.startsWith(scope)) {
          match = entry;
          length = scope.length;
        }
      }
    }
    return match;
  }

  store(url: URLRecord, entry: AuthenticationEntry, generation: number): void {
    if (generation !== this.#generation) return;
    const origin = serializeOrigin(obtainURLOrigin(url));
    let entries = this.#origins.get(origin);
    if (!entries) this.#origins.set(origin, entries = new Map<string, CachedCredentials>());
    const path = serializeURLPath(url);
    const scope = path.slice(0, path.lastIndexOf('/') + 1);
    const previous = entries.get(entry.realm);
    // Keep nested depths: they can outrank another realm even when an ancestor matches.
    const paths = previous?.paths ?? [];
    if (!paths.includes(scope)) paths.push(scope);
    entries.delete(entry.realm);
    entries.set(entry.realm, { entry, paths });
  }

  invalidate(url: URLRecord, entry: AuthenticationEntry): void {
    const origin = serializeOrigin(obtainURLOrigin(url));
    const entries = this.#origins.get(origin);
    if (entries?.get(entry.realm)?.entry !== entry) return;
    entries.delete(entry.realm);
    if (entries.size === 0) this.#origins.delete(origin);
  }

  /** Clear session credentials, including permission for pending exchanges to retain them. */
  clear(): void {
    this.#origins.clear();
    this.#generation++;
  }

  prompt(
    request: FetchRequest, realm: string, previous: AuthenticationEntry | null, controller: FetchController,
  ): InternalPromise<AuthenticationEntry | null> {
    const target = request.traversableForUserPrompts;
    if (target === null || target === undefined) throw new InternalError('HTTP authentication prompt requires a traversable');
    const promises = this.#userAgent.hostPromises;
    const result = promises.withResolvers<AuthenticationEntry | null>();
    // This signal belongs to the Node-facing prompt hook, not a page's AbortSignal implementation.
    const cancellation = new AbortController();
    const removeCancellation = controller.addCancellationSteps(() => {
      result.resolve(null);
      cancellation.abort();
    });
    if (!result.pending) return result.promise;
    const generation = this.#generation;
    let answer: AuthenticationCredentials | null | Promise<AuthenticationCredentials | null>;
    try {
      answer = this.onPrompt({
        url: stripURLForReporting(request.currentURL), realm, target,
        username: previous?.username ?? null,
        previousFailed: previous?.realm === realm,
        signal: cancellation.signal,
      });
    } catch (error) {
      removeCancellation();
      result.reject(error);
      return result.promise;
    }
    promises.resolve(answer).observe((credentials) => {
      if (!result.pending) return;
      removeCancellation();
      if (generation !== this.#generation || credentials === null ||
        encodeBasicCredentials(credentials.username, credentials.password) === null) {
        result.resolve(null);
      } else {
        result.resolve({ username: credentials.username, password: credentials.password, realm });
      }
    }, (error) => {
      if (!result.pending) return;
      removeCancellation();
      result.reject(error);
    });
    return result.promise;
  }

  // PROVISIONAL(HTTP proxy): the direct transport has no configured proxy or CONNECT route.
  // Never key proxy credentials by the destination origin or send them to that origin.
  applyProxyAuthentication(): void {}

  promptProxy(): InternalPromise<boolean> {
    return this.#userAgent.hostPromises.resolve(false);
  }
}

/** Host UI hook; its signal aborts when the requesting Fetch is canceled. */
export type AuthenticationPrompt = (challenge: {
  url: string;
  realm: string;
  target: FetchPromptTarget;
  username: string | null;
  /** Whether the preceding credentials were rejected for this realm. */
  previousFailed: boolean;
  signal: AbortSignal;
}) => AuthenticationCredentials | null | Promise<AuthenticationCredentials | null>;

type CachedCredentials = { entry: AuthenticationEntry; paths: string[]; };
