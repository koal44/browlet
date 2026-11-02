import { InternalError } from '../../../infra/index';
import type { GlobalAccessHandlers, JSRealm } from '../../../js-engine/index';
import type { AssembledInterface, BindingContext, ProjectionOverride } from '../../../web-idl/index';

import type { WindowImpl, WindowProxyHandle } from '../../browsing/window/index';
import type { BrowletEnvironment } from '../../environment';

import { CrossOriginObjectBinding } from './cross-origin';

/** Expose a Window's current public proxy while preserving its original platform target. */
export function prepareWindowProjectionOverride(owner: AssembledInterface): ProjectionOverride<WindowImpl> | undefined {
  if (owner.primary.name !== 'Window') return;
  return (window) => {
    // SPEC_CLASH(window-event-target-after-navigation): follow Chromium/WebKit's null for replaced Windows; Firefox returns WindowProxy.
    // SPEC_CLASH(window-event-target-after-removal): retain Chromium/Firefox's WindowProxy without replacement; WebKit returns null.
    // See browsing/window/ROADMAP.md and Blink DOMWindow::Wrap / WebKit toJS(DOMWindow&).
    const proxy = window.getWindowProxy();
    return proxy.windowImplementation === window ? proxy.platform : null;
  };
}

/** Select WindowProxy access policy using the accessing realm's binding. */
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-windowproxy-exotic-object
export function getWindowProxyAccess(
  owner: BindingContext<BrowletEnvironment>, proxy: WindowProxyHandle, realm: JSRealm | undefined,
): GlobalAccessHandlers {
  const caller = realm === undefined ? undefined : owner.getBindingContext(realm);
  if (!caller) throw new InternalError('WindowProxy access requires a registered caller binding');
  const binding = new CrossOriginObjectBinding(caller);
  return {
    allow: binding.isPlatformObjectSameOrigin(proxy.associatedWindow),
    // SPEC_CLASH(window-foreign-prototype): Follow Chromium's SecurityError;
    // HTML/Firefox/WebKit instead return booleans from the underlying mutations.
    deny() { throw new caller.DOMException('Cross-origin Window access is denied', 'SecurityError'); },
    // SPEC_CLASH(window-foreign-receiver): Chromium uses the target Window for
    // foreign property access. HTML/Firefox/WebKit use the supplied receiver.
    // Same-origin V8 access and explicitly called reflected accessors preserve receivers.
    get: (property) => binding.getWindowProxy(property, proxy.platform, proxy),
    set: (property, value) => binding.setWindowProxy(property, value, proxy.platform, proxy),
    getOwnPropertyDescriptor: (property) => binding.getWindowProxyOwnProperty(property, proxy),
    ownKeys: () => binding.getWindowProxyOwnPropertyKeys(proxy),
  };
}
