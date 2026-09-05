import { encodingIDLDefinitions } from '../encoding/index';
import { fileIDLDefinitions } from '../file/index';
import { styleletIDLDefinitions } from '../stylelet/web-idl';
import { streamsIDLDefinitions } from '../streams/index';
import { urlIDLDefinitions } from '../url/api';
import { originIDL } from '../url/origin-api';
import { xhrIDLDefinitions } from '../xhr/index';
import {
  createBindings, type BindingWorld, type RealmBindings, type GlobalObjectAllocation,
} from '../web-idl/index';
import { locationIDL } from './browsing/window/location';
import {
  type WindowImpl, windowEventIDL, windowIDL,
  windowIncludesWindowOrWorkerGlobalScopeIDL,
} from './browsing/window/window';
import {
  isWindowProxy, resolveWindowProxyReceiver, setWindowProxyWindow,
  type WindowProxy,
} from './browsing/window/window-proxy';
import { htmlDocumentIDL } from './dom/nodes/document';
import { domIDLDefinitions } from './dom/web-idl';
import { htmlIDLDefinitions } from './html/web-idl';
import { domExceptionCapabilities } from './integration/dom-exception';
import { fileCapabilities } from './integration/file/capabilities';
import { fileReaderIDL } from './integration/file/file-reader';
import { streamsCapabilities } from './integration/streams';
import { xhrCapabilities } from './integration/xhr';
import { mathMLIDLDefinitions } from './mathml/web-idl';
import {
  domHighResTimeStampIDL, epochTimeStampIDL, performanceIDL,
} from './performance/performance';
import {
  eventHandlerIDL, eventHandlerNonNullIDL,
} from './scripting/event-handlers';
import {
  highResolutionTimeWindowOrWorkerGlobalScopeIDL,
  timerHandlerIDL,
  windowOrWorkerGlobalScopeIDL,
} from './scripting/global-scope';
import { Realm } from './scripting/realm';
import {
  structuredSerializeOptionsIDL,
} from './scripting/structured-data/web-idl';
import { svgIDLDefinitions } from './svg/web-idl';

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
  allocation?: GlobalObjectAllocation,
): Window {
  return bindings.projectGlobalObject(window, 'Window', allocation) as Window;
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
  ...fileCapabilities,
  ...streamsCapabilities,
  ...xhrCapabilities,
];

const browletDefinitions = [
  htmlDocumentIDL,
  ...htmlIDLDefinitions,
  ...svgIDLDefinitions,
  ...mathMLIDLDefinitions,
  originIDL,
  locationIDL,
  domHighResTimeStampIDL,
  epochTimeStampIDL,
  performanceIDL,
  eventHandlerNonNullIDL,
  eventHandlerIDL,
  structuredSerializeOptionsIDL,
  timerHandlerIDL,
  windowOrWorkerGlobalScopeIDL,
  highResolutionTimeWindowOrWorkerGlobalScopeIDL,
  windowIDL,
  windowEventIDL,
  windowIncludesWindowOrWorkerGlobalScopeIDL,
  ...domIDLDefinitions,
  ...styleletIDLDefinitions,
  ...streamsIDLDefinitions,
  ...encodingIDLDefinitions,
  ...fileIDLDefinitions,
  fileReaderIDL,
  ...xhrIDLDefinitions,
  ...urlIDLDefinitions,
];

export const browletBindings = new BrowletBindings();
