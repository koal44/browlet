import { domIDLDefinitions } from '../../domlet/web-idl';
import { urlIDLDefinitions } from '../../url/web-idl';
import { assembleDefinitions } from '../../web-idl/assembly';
import { JavaScriptBinding } from '../../web-idl/binding';
import { webIDLCommonDefinitions } from '../../web-idl/common-definitions';
import type { HostDefinedInterface } from '../../web-idl/conversion';
import { ImplementationRegistry } from '../../web-idl/implementation';
import { sharedPlatformObjects } from '../../web-idl/platform-object';
import {
  originIDL, registerOriginImplementation,
} from '../origin';
import type { Realm } from '../realm';
import { isWindowProxy } from '../window-proxy';
import { DOMBinding } from './dom';
import { URLBinding } from './url';

/*
 * The browser environment owns the final Web IDL assembly for its realm.
 * Defining specifications contribute declarations and implementation steps;
 * Browlet decides which contributions coexist and which initial objects are
 * installed on its Window environment.
 */
export class BrowletBindings {
  readonly dom: DOMBinding;
  readonly url: URLBinding;
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
    this.dom = new DOMBinding(realm, this.#binding);
    this.url = new URLBinding(this.#binding);
    registerOriginImplementation(this.#binding);
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
}

const bindingsByRealm = new WeakMap<Realm, BrowletBindings>();

const hostDefinedInterfaces: HostDefinedInterface[] = [{
  is: isWindowProxy,
  name: 'WindowProxy',
}];

const browletDefinitions = assembleDefinitions([
  ...webIDLCommonDefinitions,
  originIDL,
  ...domIDLDefinitions,
  ...urlIDLDefinitions,
]);
