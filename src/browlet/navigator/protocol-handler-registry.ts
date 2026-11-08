import { InternalError, internalType, type InternalPromise, type InternalPromiseWithResolvers } from '../../infra/index';
import {
  copyURL, parseURL, serializeURL, setURLPassword, setURLUsername, utf8PercentEncode, type URLRecord,
} from '../../url/index';

import type { DocumentImpl } from '../dom/nodes/index';
import type { UserAgent } from '../user-agent';

/** Browser-owned candidates and declined requests, retained for one UserAgent's lifetime. */
// https://html.spec.whatwg.org/multipage/system-state.html#protocol-handler-registration
export class ProtocolHandlerRegistry {
  /** Owns consent, automation verification, and the continuations that can outlive Documents. */
  userAgent: UserAgent;
  /** Exact scheme/template pairs; settled decisions retain neither Documents nor promises. */
  #registrations = new Map<string, Map<string, Registration>>();

  constructor(userAgent: UserAgent) {
    this.userAgent = userAgent;
  }

  /** Inspect a normalized pair without changing its remembered decision. */
  getState(scheme: string, url: URLRecord): ProtocolHandlerState | null {
    return this.#registrations.get(scheme)?.get(serializeURL(url))?.state ?? null;
  }

  /**
   * Remember consent for a normalized pair. Acceptance makes a handler a candidate;
   * selecting a default, durable storage, and invocation belong to later host integration.
   * Repeated requests keep their existing pending or completed decision until removal.
   */
  // https://html.spec.whatwg.org/multipage/system-state.html#protocol-handler-registration
  register(scheme: string, url: URLRecord, document: DocumentImpl): InternalPromise<void> {
    const P = this.userAgent.HostPromise;
    return P.try(() => {
      const mode = document.protocolHandlerAutomationMode;
      if (mode !== 'none') this.userAgent.verifyProtocolHandlerAutomation(document);
      const template = serializeURL(url);
      let handlers = this.#registrations.get(scheme);
      const previous = handlers?.get(template);
      if (previous !== undefined) return previous.state === 'pending' ? previous.result.promise : undefined;

      if (handlers === undefined) {
        handlers = new Map<string, Registration>();
        this.#registrations.set(scheme, handlers);
      }
      const result = P.withResolvers(internalType<void>());
      const pending: Registration = { state: 'pending', result };
      handlers.set(template, pending);
      // SPEC_GAP(protocol-handler-pending-requests): Share pending decisions and ignore their result after exact-pair removal/replacement.
      const accept = (accepted: boolean) => {
        if (this.#registrations.get(scheme)?.get(template) === pending) {
          handlers.set(template, { state: accepted ? 'accepted' : 'declined' });
        }
        result.resolve(undefined);
      };
      const fail = (error: unknown) => {
        if (this.#registrations.get(scheme)?.get(template) === pending) this.#remove(scheme, template);
        result.reject(error);
      };
      try {
        if (mode === 'none') {
          P.fromInternal(this.userAgent.requestProtocolHandlerConsent(scheme, url, document)).observe(accept, fail);
        } else {
          accept(mode === 'autoAccept');
        }
      } catch (error) { fail(error); }
      return result.promise;
    }, internalType<void>());
  }

  /**
   * Prepare the destination of an already-selected, accepted scheme/template pair.
   * The input and registered template remain unchanged.
   * This extracts invocation's URL steps, without selecting a handler or navigating.
   */
  // https://html.spec.whatwg.org/multipage/system-state.html#protocol-handler-invocation
  // TODO(HTML invocation step 9): The navigation owner must select the destination
  // navigable and navigate it; UserAgent.shouldHandleURLExternally() still throws.
  getInvocationURL(scheme: string, handlerURL: URLRecord, inputURL: URLRecord): URLRecord {
    if (inputURL.scheme !== scheme) throw new InternalError('Protocol handler input scheme does not match');
    const template = serializeURL(handlerURL);
    if (this.#registrations.get(scheme)?.get(template)?.state !== 'accepted') {
      throw new InternalError('Protocol handler invocation requires an accepted registration');
    }
    // SPEC_CLASH(protocol-handler-input-copy): HTML mutates inputURL; like Chromium, strip credentials from a copy.
    const cleanInputURL = copyURL(inputURL);
    setURLUsername(cleanInputURL, '');
    setURLPassword(cleanInputURL, '');
    // SPEC_CLASH(protocol-handler-invocation-example): Follow HTML's encoding steps and Chromium/Gecko, not the less-escaped soup example.
    const encodedURL = utf8PercentEncode(serializeURL(cleanInputURL), 'component');
    const resultURL = parseURL(template.replace('%s', encodedURL)).url;
    if (resultURL === null) throw new InternalError('Protocol handler destination could not be parsed');
    return resultURL;
  }

  /** Forget only the normalized pair, including a rejection or an outstanding request. */
  // https://html.spec.whatwg.org/multipage/system-state.html#dom-navigator-unregisterprotocolhandler
  unregister(scheme: string, url: URLRecord): void {
    // SPEC_GAP(protocol-handler-forget-decision): Like Chromium, explicit removal also forgets a declined request.
    this.#remove(scheme, serializeURL(url));
  }

  #remove(scheme: string, template: string): void {
    const handlers = this.#registrations.get(scheme);
    if (handlers === undefined) return;
    handlers.delete(template);
    if (handlers.size === 0) this.#registrations.delete(scheme);
  }
}

// https://html.spec.whatwg.org/multipage/system-state.html#rph-user-agent-automation
export type ProtocolHandlerAutomationMode = 'none' | 'autoAccept' | 'autoReject';
export type ProtocolHandlerState = 'pending' | 'accepted' | 'declined';

type Registration =
  | { state: 'pending'; result: InternalPromiseWithResolvers<void>; }
  | { state: 'accepted' | 'declined'; };
