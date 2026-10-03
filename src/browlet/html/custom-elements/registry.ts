import { defineInterface, impl } from '../../../web-idl/index';

/** Preserves custom-element registry identity until definition and upgrade are implemented. */
// https://html.spec.whatwg.org/multipage/custom-elements.html#customelementregistry
export class CustomElementRegistryImpl {}

// The existing Document getter needs a declared projection for this identity.
// TODO: Implement registry members and expose the CustomElementRegistry interface on Window.
export const customElementRegistryIDL = defineInterface({
  name: 'CustomElementRegistry',
  implementation: impl(CustomElementRegistryImpl),
  members: [],
});
