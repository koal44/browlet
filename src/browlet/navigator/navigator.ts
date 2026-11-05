import { atArg, defineInterface, impl } from '../../web-idl/core/index';
import type { PermissionsImpl } from '../../permissions/index';
import type { StorageManagerImpl } from '../../storage/index';

import { ClipboardImpl } from '../interaction/clipboard/index';
import type { BrowletEnvironment } from '../environment/index';

/** Stable Window navigator identity; independent specifications contribute its capabilities. */
// https://html.spec.whatwg.org/multipage/system-state.html#the-navigator-object
// TODO(HTML §8.10): Identification, language, online state, protocol handlers, cookies, and plugins.
export class NavigatorImpl {
  /** Relevant settings, shared with this Navigator's owning Window. */
  env: BrowletEnvironment;
  #clipboard: ClipboardImpl | null = null;

  constructor(env: BrowletEnvironment) {
    this.env = env;
  }

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
}

// [Exposed=Window] interface Navigator { };
export const navigatorIDL = defineInterface<BrowletEnvironment>({
  name: 'Navigator',
  exposed: 'Window',
  implementation: impl(NavigatorImpl, { constructWith: [atArg(0, (env) => env)] }),
  members: [],
});
