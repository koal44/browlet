import { domIDLDefinitions } from '../../domlet/web-idl';
import type { DOMNodeFactory } from '../../domlet/nodes/document';
import { urlIDLDefinitions } from '../../url/api';
import { assembleDefinitions } from '../../web-idl/adapter/assembly';
import { JavaScriptBinding } from '../../web-idl/binding';
import { webIDLCommonDefinitions } from '../../web-idl/common-definitions';
import type { HostDefinedInterface } from '../../web-idl/conversion';
import {
  createPlatformObjectAdapter, registerInterfaceBindings,
} from '../../web-idl/adapter/projection';
import { ImplementationRegistry } from '../../web-idl/adapter/registry';
import { sharedPlatformObjects } from '../../web-idl/platform-object';
import type { Realm } from '../realm';
import type { WindowImpl } from '../window';
import { isWindowProxy } from '../window-proxy';
import { browletIDLDefinitions } from '../web-idl';

/*
 * The browser environment owns the final Web IDL assembly for its realm.
 * Defining specifications contribute declarations and implementation steps;
 * Browlet decides which contributions coexist and which initial objects are
 * installed on its Window environment.
 */
export class BrowletBindings {
  readonly nodeFactory: DOMNodeFactory;
  readonly #binding: JavaScriptBinding;

  constructor(realm: Realm) {
    if (bindingsByRealm.has(realm)) {
      throw new Error('A Realm can have only one Browlet binding');
    }

    const implementations = new ImplementationRegistry();
    this.#binding = new JavaScriptBinding(
      browletDefinitions,
      realm,
      sharedPlatformObjects,
      implementations,
      hostDefinedInterfaces,
    );
    const objects = createPlatformObjectAdapter(this.#binding);
    this.nodeFactory = objects;
    registerInterfaceBindings(this.#binding, webIDLCommonDefinitions);
    registerInterfaceBindings(this.#binding, domIDLDefinitions, {
      normalizeException: (exception) => this.#normalizeDOMException(exception),
    });
    registerInterfaceBindings(this.#binding, urlIDLDefinitions);
    registerInterfaceBindings(this.#binding, browletIDLDefinitions);
    bindingsByRealm.set(realm, this);
  }

  static forRealm(realm: Realm): BrowletBindings {
    const bindings = bindingsByRealm.get(realm);
    if (!bindings) throw new Error('Realm has no Browlet binding');
    return bindings;
  }

  install(target: object): void {
    this.#binding.install(target);
  }

  projectWindow(window: WindowImpl): Window {
    return this.#binding.projectGlobalObject(window, 'Window').object as Window;
  }

  // -- Private ----------------------------------------------------------

  #normalizeDOMException(exception: unknown): unknown {
    if (this.#binding.implements(exception, 'DOMException')) return exception;
    if (!(exception instanceof DOMException)) return exception;

    const DOMException_ = this.#binding.getInterfaceObject(
      'DOMException',
    ) as unknown as typeof DOMException;
    return new DOMException_(exception.message, exception.name);
  }
}

const bindingsByRealm = new WeakMap<Realm, BrowletBindings>();

const hostDefinedInterfaces: HostDefinedInterface[] = [{
  is: isWindowProxy,
  name: 'WindowProxy',
}];

const browletDefinitions = assembleDefinitions([
  ...webIDLCommonDefinitions,
  ...browletIDLDefinitions,
  ...domIDLDefinitions,
  ...urlIDLDefinitions,
]);
