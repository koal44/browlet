import { domIDLDefinitions } from '../../domlet/web-idl';
import { urlIDLDefinitions } from '../../url/web-idl';
import { assembleDefinitions } from '../../web-idl/assembly';
import { JavaScriptBinding } from '../../web-idl/binding';
import { ImplementationRegistry } from '../../web-idl/implementation';
import { sharedPlatformObjects } from '../../web-idl/platform-object';
import {
  originIDL, registerOriginImplementation,
} from '../origin';
import type { Realm } from '../realm';
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
    const implementations = new ImplementationRegistry();
    this.#binding = new JavaScriptBinding(
      browletDefinitions,
      realm,
      sharedPlatformObjects,
      implementations,
    );
    this.dom = new DOMBinding(realm, this.#binding);
    this.url = new URLBinding(this.#binding);
    registerOriginImplementation(this.#binding);
  }

  install(target: object): void {
    this.#binding.install(target);
  }
}

const browletDefinitions = assembleDefinitions([
  originIDL,
  ...domIDLDefinitions,
  ...urlIDLDefinitions,
]);
