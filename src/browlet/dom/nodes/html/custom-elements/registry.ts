import { defineInterface, impl } from '../../../../../web-idl/index';

import type { DocumentImpl } from '../../document';
import type { CustomElementDefinition } from './definition';

/** Owns custom-element definitions and registry association state. */
// https://html.spec.whatwg.org/multipage/custom-elements.html#customelementregistry
export class CustomElementRegistryImpl {
  /** Validated definitions; public definition and upgrade algorithms remain unimplemented. */
  // https://html.spec.whatwg.org/multipage/custom-elements.html#custom-element-definition-set
  definitions = new Set<CustomElementDefinition>();
  /** Existing composition creates global registries; scoped construction is unfinished. */
  isScoped = false;
  /** Documents to search for upgrade candidates when this scoped registry receives a definition. */
  scopedDocumentSet = new Set<DocumentImpl>();

  /** Find a definition by author constructor identity; an undefined NewTarget has no match. */
  getDefinitionForConstructor(constructor?: object): CustomElementDefinition | undefined {
    for (const definition of this.definitions) {
      if (definition.constructor === constructor) return definition;
    }
  }
}

/*
 * [Exposed=Window]
 * interface CustomElementRegistry {
 *   constructor();
 *
 *   [CEReactions] undefined define(DOMString name, CustomElementConstructor constructor, optional ElementDefinitionOptions options = {});
 *   (CustomElementConstructor or undefined) get(DOMString name);
 *   DOMString? getName(CustomElementConstructor constructor);
 *   Promise<CustomElementConstructor> whenDefined(DOMString name);
 *   [CEReactions] undefined upgrade(Node root);
 *   [CEReactions] undefined initialize(Node root);
 * };
 *
 * callback CustomElementConstructor = HTMLElement ();
 *
 * dictionary ElementDefinitionOptions {
 *   DOMString extends;
 * };
 */
// The existing Document getter needs a declared projection for this identity.
// TODO: Implement registry members and expose the CustomElementRegistry interface on Window.
export const customElementRegistryIDL = defineInterface({
  name: 'CustomElementRegistry',
  implementation: impl(CustomElementRegistryImpl),
  members: [],
});
