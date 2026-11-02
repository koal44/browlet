import { InternalError, type InternalPromise } from '../../../../infra/index';
import {
  arg, defineCallbackFunction, defineInterface, DOMExceptionImpl, emptyDictionary, idlType, impl, op, promise, reference,
} from '../../../../web-idl/core/index';

import type { BrowletEnvironment } from '../../../environment/index';

import type { NavigationImpl, NavigationNavigateOptions } from './navigation';
import type { NavigateEventImpl, NavigationInterceptHandler } from './navigate-event';

/** Event-owned controller supplied to precommit handlers before a navigation commits. */
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigationprecommitcontroller
export class NavigationPrecommitControllerImpl {
  /** Environment owning the controller's platform object. */
  env: BrowletEnvironment;
  /** Navigate event whose destination and handler list the controller manages. */
  event: NavigateEventImpl;

  constructor(event: NavigateEventImpl, env: BrowletEnvironment) {
    this.env = env;
    this.event = event;
  }

  /** Redirect the intercepted navigation before commit. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-navigationprecommitcontroller-redirect
  redirect(url: string, options: NavigationNavigateOptions): void {
    const event = this.event;
    if (event.interceptionState === 'none') throw new InternalError('A precommit controller requires interception');
    event.performSharedChecks();
    if (event.interceptionState !== 'intercepted') {
      throw new DOMExceptionImpl('The navigation has already committed', 'InvalidStateError');
    }
    if (event.navigationType !== 'push' && event.navigationType !== 'replace') {
      throw new DOMExceptionImpl('Only push and replace navigations can redirect', 'InvalidStateError');
    }
    const document = this.env.getAssociatedDocument()!;
    const destinationURL = document.parseHTMLURL(url);
    if (destinationURL === null) throw new DOMExceptionImpl('Invalid redirect URL', 'SyntaxError');
    if (!document.canHaveURLRewritten(destinationURL)) {
      throw new DOMExceptionImpl('The Document cannot rewrite its URL to this destination', 'SecurityError');
    }
    // SPEC_CLASH(navigation-redirect-history-order): Follow HTML/Gecko/WebKit's type change before
    // serialization; Chromium changes it afterward, so a cloning failure leaves its old type intact.
    if (options.history === 'push' || options.history === 'replace') event.navigationType = options.history;
    if (options.state !== undefined) {
      const navigation = event.target as NavigationImpl;
      const tracker = navigation.ongoingAPIMethodTracker;
      const serializedState = this.env.serializeForStorage(options.state);
      event.destination.state = serializedState;
      // SPEC_CLASH(navigation-redirect-reentrancy): HTML/Blink/Gecko's later lookup overwrites a new
      // navigation started by a state getter. Only update the original tracker while still registered.
      if (tracker !== null && navigation.ongoingAPIMethodTracker === tracker) {
        tracker.serializedState = serializedState;
      }
    }
    event.destination.urlRecord = destinationURL;
    if (options.info !== undefined) event.info = options.info;
  }

  /** Register another postcommit handler from a precommit handler. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-navigationprecommitcontroller-addhandler
  addHandler(handler: NavigationInterceptHandler): void {
    const event = this.event;
    if (event.interceptionState === 'none') throw new InternalError('A precommit controller requires interception');
    event.performSharedChecks();
    if (event.interceptionState !== 'intercepted') {
      throw new DOMExceptionImpl('The navigation has already committed', 'InvalidStateError');
    }
    event.navigationHandlerList.push(handler);
  }
}

/** Converted precommit callback; bindings project the controller and adapt its promise result. */
export type NavigationPrecommitHandler = (controller: NavigationPrecommitControllerImpl) => InternalPromise<void>;

/*
 * [Exposed=Window]
 * interface NavigationPrecommitController {
 *   undefined redirect(USVString url, optional NavigationNavigateOptions options = {});
 *   undefined addHandler(NavigationInterceptHandler handler);
 * };
 */
export const navigationPrecommitControllerIDL = defineInterface({
  name: 'NavigationPrecommitController', exposed: 'Window', implementation: impl(NavigationPrecommitControllerImpl),
  members: [
    op('redirect', idlType.undefined,
      [arg('url', idlType.USVString), arg('options', reference('NavigationNavigateOptions'), { optional: true, default: emptyDictionary })],
    ),
    op('addHandler', idlType.undefined, [arg('handler', reference('NavigationInterceptHandler'))]),
  ],
});

/*
 * callback NavigationPrecommitHandler = Promise<undefined> (NavigationPrecommitController controller);
 */
export const navigationPrecommitHandlerIDL = defineCallbackFunction({
  name: 'NavigationPrecommitHandler', returns: promise(idlType.undefined),
  arguments: [arg('controller', reference('NavigationPrecommitController'))],
});
