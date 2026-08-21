import { domIDLDefinitions } from '../domlet/web-idl';
import { assembleDefinitions } from '../web-idl/assembly';
import { JavaScriptBinding } from '../web-idl/binding';
import { ImplementationRegistry } from '../web-idl/implementation';
import { sharedPlatformObjects } from '../web-idl/platform-object';
import { DOMBinding } from './dom-binding';
import type { Realm } from './realm';

/*
 * The browser environment owns the final Web IDL assembly for its realm.
 * Defining specifications contribute declarations and implementation steps;
 * Browlet decides which contributions coexist and which initial objects are
 * installed on its Window environment.
 */
export class BrowletBindings {
  readonly dom: DOMBinding;
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
  }

  install(target: object): void {
    this.#binding.install(target);
  }
}

const browletDefinitions = assembleDefinitions([
  ...domIDLDefinitions,
]);
