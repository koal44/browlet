import { defineInterfaceMixin, idlType, roAttr } from '../../web-idl/core/index';
import { getEnvironmentDefaultUserAgent } from '../../fetch/index';

import type { BrowletEnvironment } from '../environment/index';

/** Shared client identification using HTML's Chrome navigator compatibility mode. */
// https://html.spec.whatwg.org/multipage/system-state.html#client-identification
export class NavigatorIDMixin {
  /** Relevant settings of the including Navigator or WorkerNavigator. */
  env: BrowletEnvironment;

  constructor(env: BrowletEnvironment) {
    this.env = env;
  }

  // https://html.spec.whatwg.org/multipage/system-state.html#dom-navigator-appcodename
  get appCodeName(): string { return 'Mozilla'; }

  // https://html.spec.whatwg.org/multipage/system-state.html#dom-navigator-appname
  get appName(): string { return 'Netscape'; }

  /** Derive the version from the same environment-specific identification used by Fetch. */
  // https://html.spec.whatwg.org/multipage/system-state.html#dom-navigator-appversion
  get appVersion(): string {
    const userAgent = getEnvironmentDefaultUserAgent(this.env);
    // SPEC_CLASH(navigator-appversion-prefix): Follow HTML's exact prefix; Chromium/WebKit remove through the first slash.
    return userAgent.startsWith('Mozilla/5.0 (') ? userAgent.slice('Mozilla/'.length) : '';
  }

  /** The UserAgent's configured compatibility platform, independent of the physical host OS. */
  // https://html.spec.whatwg.org/multipage/system-state.html#dom-navigator-platform
  get platform(): string { return this.env.userAgent.navigatorPlatform; }

  // https://html.spec.whatwg.org/multipage/system-state.html#dom-navigator-product
  get product(): string { return 'Gecko'; }

  // https://html.spec.whatwg.org/multipage/system-state.html#dom-navigator-productsub
  get productSub(): string { return '20030107'; }

  // https://html.spec.whatwg.org/multipage/system-state.html#dom-navigator-useragent
  get userAgent(): string { return getEnvironmentDefaultUserAgent(this.env); }

  // https://html.spec.whatwg.org/multipage/system-state.html#dom-navigator-vendor
  get vendor(): string { return 'Google Inc.'; }

  // https://html.spec.whatwg.org/multipage/system-state.html#dom-navigator-vendorsub
  get vendorSub(): string { return ''; }
}

export const navigatorIDIDL = defineInterfaceMixin({
  name: 'NavigatorID',
  members: [
    roAttr('appCodeName', idlType.DOMString),
    roAttr('appName', idlType.DOMString),
    roAttr('appVersion', idlType.DOMString),
    roAttr('platform', idlType.DOMString),
    roAttr('product', idlType.DOMString),
    roAttr('productSub', idlType.DOMString, { exposed: 'Window' }),
    roAttr('userAgent', idlType.DOMString),
    roAttr('vendor', idlType.DOMString, { exposed: 'Window' }),
    roAttr('vendorSub', idlType.DOMString, { exposed: 'Window' }),
  ],
});
