import { domIDLDefinitions } from '../domlet/web-idl';
import { urlIDLDefinitions } from '../url/api';
import {
  registerInterfaceBindings, type InterfaceBindingDomain,
  type RegisteredRealmInterfaceBindings,
} from '../web-idl/index';
import { Realm } from './realm';
import type { WindowImpl } from './window';
import {
  isWindowProxy, setWindowProxyWindow, type WindowProxy,
} from './window-proxy';
import { browletIDLDefinitions } from './web-idl';

/*
 * The browser environment owns the final Web IDL assembly for its realm.
 * Defining specifications contribute declarations and implementation steps;
 * Browlet decides which contributions coexist and which initial objects are
 * installed on its Window environment.
 */
export class BrowletBindings {
  readonly #domain: InterfaceBindingDomain;

  constructor() {
    this.#domain = registerInterfaceBindings(
      browletDefinitions,
      { hostDefinedInterfaces },
    );
  }

  register(realm: Realm): RegisteredRealmInterfaceBindings {
    return this.#domain.register(realm);
  }

  forRealm(realm: Realm): RegisteredRealmInterfaceBindings {
    const bindings = this.#domain.forRealm(realm);
    if (!bindings) throw new Error('Realm has no Browlet binding');
    return bindings;
  }

  retargetWindowProxy(
    windowProxy: WindowProxy,
    window: WindowImpl,
  ): void {
    const windowObject = this.#domain.getPlatformObject(window);
    if (!windowObject) throw new Error('Window has not been projected');
    setWindowProxyWindow(
      windowProxy,
      window,
      windowObject as Window,
    );
  }

  getRelevantRealm(value: object): Realm {
    const platformRealm = this.#domain.getRealm(value);
    if (platformRealm instanceof Realm) return platformRealm;

    const realm = Realm.getAssociatedRealm(value);
    if (!realm) throw new Error('Object has no relevant Realm');
    return realm;
  }
}

export function projectWindow(
  bindings: RegisteredRealmInterfaceBindings,
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
}];

const browletDefinitions = [
  ...browletIDLDefinitions,
  ...domIDLDefinitions,
  ...urlIDLDefinitions,
] as const;

export const browletBindings = new BrowletBindings();
