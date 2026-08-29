import { domIDLDefinitions } from './dom/web-idl';
import { encodingIDLDefinitions } from '../encoding/index';
import { fileIDLDefinitions } from '../file/index';
import { styleletIDLDefinitions } from '../stylelet/web-idl';
import { streamsIDLDefinitions } from '../streams/index';
import { streamAbortController } from '../streams/abort';
import { streamStructuredData } from '../streams/structured-data';
import { urlIDLDefinitions } from '../url/api';
import {
  createBindings, type BindingWorld, type RealmBindings,
} from '../web-idl/index';
import { Realm } from './scripting/realm';
import { AbortControllerImpl } from './dom/abort/abort-controller';
import { WindowImpl, windowIDL } from './browsing/window/window';
import {
  isWindowProxy, resolveWindowProxyReceiver, setWindowProxyWindow,
  type WindowProxy,
} from './browsing/window/window-proxy';
import { browletIDLDefinitions } from './web-idl';
import {
  domExceptionCapabilities,
} from './scripting/structured-data/platform-objects/dom-exception';
import {
  blobCapabilities,
} from './scripting/structured-data/platform-objects/blob';
import { fileHostCapability } from './file-api';

/*
 * The browser environment owns the final Web IDL assembly for its realm.
 * Defining specifications contribute declarations and implementation steps;
 * Browlet decides which contributions coexist and which initial objects are
 * installed on its Window environment. One main binding world spans the realms
 * hosted by Browlet's Node VM; it is not owned by an HTML Agent or AgentCluster.
 */
export class BrowletBindings {
  readonly #world: BindingWorld;

  constructor() {
    this.#world = createBindings(
      browletDefinitions,
      {
        capabilities: browletCapabilities,
        hostDefinedInterfaces,
      },
    );
  }

  register(realm: Realm): RealmBindings {
    return this.#world.register(realm);
  }

  forRealm(realm: Realm): RealmBindings {
    const bindings = this.#world.forRealm(realm);
    if (!bindings) throw new Error('Realm has no Browlet binding');
    return bindings;
  }

  retargetWindowProxy(
    windowProxy: WindowProxy,
    window: WindowImpl,
  ): void {
    const windowObject = this.#world.getPlatformObject(window);
    if (!windowObject) throw new Error('Window has not been projected');
    setWindowProxyWindow(
      windowProxy,
      window,
      windowObject as Window,
    );
  }

  getRelevantRealm(value: object): Realm {
    const platformRealm = this.#world.getRealm(value);
    if (platformRealm instanceof Realm) return platformRealm;

    const realm = Realm.getAssociatedRealm(value);
    if (!realm) throw new Error('Object has no relevant Realm');
    return realm;
  }

  getPlatformObject(value: object): object {
    const object = this.#world.getPlatformObject(value);
    if (!object) throw new Error('Implementation has not been projected');
    return object;
  }

  getImplementation<Value extends object>(value: object): Value {
    const implementation = this.#world.getImplementationObject(value);
    if (!implementation) throw new Error('Value is not a platform object');
    return implementation as Value;
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

const browletCapabilities = [
  ...domExceptionCapabilities,
  ...blobCapabilities,
  fileHostCapability,
  streamAbortController.for(windowIDL, {
    create(global) {
      if (!WindowImpl.is(global)) {
        throw new TypeError(
          'Streams AbortController requires a Window global',
        );
      }
      const realm = browletBindings.getRelevantRealm(global);
      const context = browletBindings.forRealm(realm).context;
      return context.construct(AbortControllerImpl);
    },
  }),
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
  ...encodingIDLDefinitions,
  ...fileIDLDefinitions,
  ...urlIDLDefinitions,
] as const;

export const browletBindings = new BrowletBindings();
