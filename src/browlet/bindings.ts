import { domIDLDefinitions } from './dom/web-idl';
import { styleletIDLDefinitions } from '../stylelet/web-idl';
import { streamsIDLDefinitions } from '../streams/index';
import { streamStructuredData } from '../streams/environment';
import { urlIDLDefinitions } from '../url/api';
import {
  createBindings, type Bindings, type RealmBindings,
} from '../web-idl/index';
import { Realm } from './scripting/realm';
import { WindowImpl, windowIDL } from './browsing/window/window';
import {
  isWindowProxy, resolveWindowProxyReceiver, setWindowProxyWindow,
  type WindowProxy,
} from './browsing/window/window-proxy';
import { browletIDLDefinitions } from './web-idl';
import {
  domExceptionCapabilities,
} from './scripting/structured-data/platform-objects/dom-exception';

/*
 * The browser environment owns the final Web IDL assembly for its realm.
 * Defining specifications contribute declarations and implementation steps;
 * Browlet decides which contributions coexist and which initial objects are
 * installed on its Window environment.
 */
export class BrowletBindings {
  readonly #bindings: Bindings;

  constructor() {
    this.#bindings = createBindings(
      browletDefinitions,
      {
        capabilities: structuredDataCapabilities,
        hostDefinedInterfaces,
      },
    );
  }

  register(realm: Realm): RealmBindings {
    return this.#bindings.register(realm);
  }

  forRealm(realm: Realm): RealmBindings {
    const bindings = this.#bindings.forRealm(realm);
    if (!bindings) throw new Error('Realm has no Browlet binding');
    return bindings;
  }

  retargetWindowProxy(
    windowProxy: WindowProxy,
    window: WindowImpl,
  ): void {
    const windowObject = this.#bindings.getPlatformObject(window);
    if (!windowObject) throw new Error('Window has not been projected');
    setWindowProxyWindow(
      windowProxy,
      window,
      windowObject as Window,
    );
  }

  getRelevantRealm(value: object): Realm {
    const platformRealm = this.#bindings.getRealm(value);
    if (platformRealm instanceof Realm) return platformRealm;

    const realm = Realm.getAssociatedRealm(value);
    if (!realm) throw new Error('Object has no relevant Realm');
    return realm;
  }
}

export function projectWindow(
  bindings: RealmBindings,
  window: WindowImpl,
): Window {
  return bindings.projectGlobalObject(window, 'Window') as Window;
}

export function getRelevantRealm(value: object): Realm {
  return browletBindings.getRelevantRealm(value);
}

const hostDefinedInterfaces = [{
  is: isWindowProxy,
  name: 'WindowProxy',
  resolveReceiver: resolveWindowProxyReceiver,
}];

const structuredDataCapabilities = [
  ...domExceptionCapabilities,
  streamStructuredData.for(windowIDL, {
    clone(global, value) {
      if (!WindowImpl.is(global)) {
        throw new TypeError('Streams structured data requires a Window global');
      }
      return WindowImpl.getWindowOrWorkerGlobalScopeMixin(global)
        .structuredClone(value);
    },
  }),
];

const browletDefinitions = [
  ...browletIDLDefinitions,
  ...domIDLDefinitions,
  ...styleletIDLDefinitions,
  ...streamsIDLDefinitions,
  ...urlIDLDefinitions,
] as const;

export const browletBindings = new BrowletBindings();
