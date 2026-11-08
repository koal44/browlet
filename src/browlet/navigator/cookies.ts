import { defineInterfaceMixin, idlType, roAttr } from '../../web-idl/core/index';

import type { BrowletEnvironment } from '../environment/index';

/** Report the cookie policy shared by this browser's Documents and Fetch requests. */
// https://html.spec.whatwg.org/multipage/system-state.html#cookies
export class NavigatorCookiesMixin {
  /** Relevant settings of the including Window Navigator. */
  env: BrowletEnvironment;

  constructor(env: BrowletEnvironment) {
    this.env = env;
  }

  /** Cookie handling is enabled; individual cookie operations can still be rejected. */
  // https://html.spec.whatwg.org/multipage/system-state.html#dom-navigator-cookieenabled
  get cookieEnabled(): boolean {
    // SPEC_CLASH(navigator-cookies-detached): Follow HTML/Firefox's browser policy; Chromium/WebKit return false after frame removal.
    return this.env.userAgent.cookiesEnabled;
  }
}

export const navigatorCookiesIDL = defineInterfaceMixin({
  name: 'NavigatorCookies',
  members: [roAttr('cookieEnabled', idlType.boolean)],
});
