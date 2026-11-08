import { asciiLower, InternalError } from '../../infra/index';
import { arg, defineInterfaceMixin, DOMExceptionImpl, DOMExceptionNames, idlType, op, xattr } from '../../web-idl/core/index';
import { areSameOrigin, obtainURLOrigin, serializeURL, type URLRecord } from '../../url/index';
import { isHTTPScheme } from '../../fetch/index';

import type { BrowletEnvironment } from '../environment/index';

/** Validate custom scheme handlers before handing registration/removal to the browser owner. */
// https://html.spec.whatwg.org/multipage/system-state.html#custom-handlers
export class NavigatorContentUtilsMixin {
  /** Relevant settings of the including Window Navigator. */
  env: BrowletEnvironment;

  constructor(env: BrowletEnvironment) {
    this.env = env;
  }

  // https://html.spec.whatwg.org/multipage/system-state.html#dom-navigator-registerprotocolhandler
  registerProtocolHandler(scheme: string, url: string): void {
    const [normalizedScheme, urlRecord] = normalizeProtocolHandlerParameters(scheme, url, this.env);
    const document = this.env.getAssociatedDocument();
    if (document === null) throw new InternalError('Protocol handler registration requires a Window Document');
    const userAgent = this.env.userAgent;
    this.env.runInParallel(() => { userAgent.registerProtocolHandler(normalizedScheme, urlRecord, document); });
  }

  // https://html.spec.whatwg.org/multipage/system-state.html#dom-navigator-unregisterprotocolhandler
  unregisterProtocolHandler(scheme: string, url: string): void {
    const [normalizedScheme, urlRecord] = normalizeProtocolHandlerParameters(scheme, url, this.env);
    const document = this.env.getAssociatedDocument();
    if (document === null) throw new InternalError('Protocol handler removal requires a Window Document');
    const userAgent = this.env.userAgent;
    this.env.runInParallel(() => { userAgent.unregisterProtocolHandler(normalizedScheme, urlRecord, document); });
  }
}

/** Normalize converted arguments against the receiver's current API base URL, encoding, and origin. */
// https://html.spec.whatwg.org/multipage/system-state.html#normalize-protocol-handler-parameters
function normalizeProtocolHandlerParameters(scheme: string, url: string, env: BrowletEnvironment): [string, URLRecord] {
  scheme = asciiLower(scheme);
  // SPEC_CLASH(protocol-handler-validation-order): Follow HTML/Chromium's scheme-first checks; Firefox validates the URL first.
  if (!safelistedSchemes.has(scheme) && !/^web\+[a-z]+$/.test(scheme)) {
    throw new DOMExceptionImpl('Protocol handler scheme is not allowed', DOMExceptionNames.security);
  }
  if (!url.includes('%s')) throw new DOMExceptionImpl('Protocol handler URL must contain %s', DOMExceptionNames.syntax);
  const urlRecord = env.encodingParseURL(url);
  if (urlRecord === null) throw new DOMExceptionImpl('Invalid protocol handler URL', DOMExceptionNames.syntax);
  // SPEC_CLASH(protocol-handler-discarded-placeholder): Like Firefox, reject a token lost during URL parsing; HTML checks only the input.
  if (!serializeURL(urlRecord).includes('%s')) {
    throw new DOMExceptionImpl('Parsed protocol handler URL must contain %s', DOMExceptionNames.syntax);
  }
  if (!isHTTPScheme(urlRecord.scheme) || !areSameOrigin(obtainURLOrigin(urlRecord), env.origin)) {
    throw new DOMExceptionImpl('Protocol handler URL must be an HTTP(S) URL with the same origin', DOMExceptionNames.security);
  }
  // SPEC_CLASH(protocol-handler-normalized-url): The normalizer returns a URL record, but its callers call it a string. Retain the record.
  return [scheme, urlRecord];
}

// https://html.spec.whatwg.org/multipage/system-state.html#safelisted-scheme
const safelistedSchemes = new Set([
  'bitcoin', 'ftp', 'ftps', 'geo', 'im', 'irc', 'ircs', 'magnet', 'mailto', 'matrix', 'mms', 'news',
  'nntp', 'openpgp4fpr', 'sftp', 'sip', 'sms', 'smsto', 'ssh', 'tel', 'urn', 'webcal', 'wtai', 'xmpp',
]);

// SPEC_CLASH(protocol-handler-exposure): Follow HTML/Chromium; Firefox exposes only registration, and WebKit neither method.
export const navigatorContentUtilsIDL = defineInterfaceMixin({
  name: 'NavigatorContentUtils',
  members: [
    op('registerProtocolHandler', idlType.undefined,
      [arg('scheme', idlType.DOMString), arg('url', idlType.USVString)],
      xattr('SecureContext'),
    ),
    op('unregisterProtocolHandler', idlType.undefined,
      [arg('scheme', idlType.DOMString), arg('url', idlType.USVString)],
      xattr('SecureContext'),
    ),
  ],
});
