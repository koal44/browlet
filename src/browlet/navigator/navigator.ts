import { atArg, defineInterface, impl } from '../../web-idl/core/index';
import type { PermissionsImpl } from '../../permissions/index';
import type { StorageManagerImpl } from '../../storage/index';

import { ClipboardImpl } from '../interaction/clipboard/index';
import type { BrowletEnvironment } from '../environment/index';

import { NavigatorIDMixin } from './identification';
import { NavigatorLanguageMixin } from './language';
import { NavigatorOnLineMixin } from './online';

/** Stable Window navigator identity; independent specifications contribute its capabilities. */
// https://html.spec.whatwg.org/multipage/system-state.html#the-navigator-object
// TODO(HTML §8.10): Protocol handlers, cookies, and plugins.
export class NavigatorImpl {
  /** Relevant settings, shared with this Navigator's owning Window. */
  env: BrowletEnvironment;
  /** Identification behavior composed with this Navigator's relevant settings. */
  #navigatorIDMixin: NavigatorIDMixin;
  /** Published language snapshot and its global-task notifications. */
  #navigatorLanguageMixin: NavigatorLanguageMixin;
  /** Live connectivity getter and queued transition notifications. */
  #navigatorOnLineMixin: NavigatorOnLineMixin;
  #clipboard: ClipboardImpl | null = null;

  constructor(env: BrowletEnvironment) {
    this.env = env;
    this.#navigatorIDMixin = new NavigatorIDMixin(env);
    this.#navigatorLanguageMixin = new NavigatorLanguageMixin(env);
    this.#navigatorOnLineMixin = new NavigatorOnLineMixin(env);
  }

  get appCodeName(): string { return this.#navigatorIDMixin.appCodeName; }
  get appName(): string { return this.#navigatorIDMixin.appName; }
  get appVersion(): string { return this.#navigatorIDMixin.appVersion; }
  get platform(): string { return this.#navigatorIDMixin.platform; }
  get product(): string { return this.#navigatorIDMixin.product; }
  get productSub(): string { return this.#navigatorIDMixin.productSub; }
  get userAgent(): string { return this.#navigatorIDMixin.userAgent; }
  get vendor(): string { return this.#navigatorIDMixin.vendor; }
  get vendorSub(): string { return this.#navigatorIDMixin.vendorSub; }

  get language(): string { return this.#navigatorLanguageMixin.language; }
  get languages(): readonly string[] { return this.#navigatorLanguageMixin.languages; }

  get onLine(): boolean { return this.#navigatorOnLineMixin.onLine; }

  /** Stable Clipboard object belonging to this Navigator's Window environment. */
  // https://w3c.github.io/clipboard-apis/#h-navigator-clipboard
  get clipboard(): ClipboardImpl {
    return this.#clipboard ??= new ClipboardImpl(this.env);
  }

  /** Return this Navigator's Permissions object in its relevant environment. */
  // https://w3c.github.io/permissions/#dom-navigator-permissions
  get permissions(): PermissionsImpl {
    return this.env.permissions;
  }

  /** Return the StorageManager associated with this Navigator's relevant settings. */
  // https://storage.spec.whatwg.org/#dom-navigatorstorage-storage
  get storage(): StorageManagerImpl {
    return this.env.storageManager;
  }

  /** Device touch capacity, unless automation supplies an override for this Navigator's environment. */
  // https://w3c.github.io/pointerevents/#dom-navigator-maxtouchpoints
  get maxTouchPoints(): number {
    const userAgent = this.env.userAgent;
    return userAgent.webDriverBiDiEmulatedMaxTouchPoints(this.env) ?? userAgent.getMaxTouchPoints();
  }

  /** Queue selected language tags before their preference/emulation source changes. */
  queueLanguageChange(tags: readonly [string, ...string[]], emulationUpdated = false): void {
    this.#navigatorLanguageMixin.queueLanguageChange(tags, emulationUpdated);
  }

  /** Queue a transition after the producer changes the connectivity/emulation source. */
  queueOnlineStateChange(wasOnline: boolean): void {
    this.#navigatorOnLineMixin.queueOnlineStateChange(wasOnline);
  }
}

// [Exposed=Window] interface Navigator { };
export const navigatorIDL = defineInterface<BrowletEnvironment>({
  name: 'Navigator',
  exposed: 'Window',
  implementation: impl(NavigatorImpl, { constructWith: [atArg(0, (env) => env)] }),
  members: [],
});
