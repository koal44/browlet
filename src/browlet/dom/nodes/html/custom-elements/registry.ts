import { defineInterface, impl } from '../../../../../web-idl/index';

import type { DocumentImpl } from '../../document';

/** Preserves custom-element registry identity until definition and upgrade are implemented. */
// https://html.spec.whatwg.org/multipage/custom-elements.html#customelementregistry
export class CustomElementRegistryImpl {
  /** Existing composition creates global registries; scoped construction is unfinished. */
  isScoped = false;
  /** Documents associated with a scoped registry by insertion. */
  scopedDocumentSet = new Set<DocumentImpl>();
}

// The existing Document getter needs a declared projection for this identity.
// TODO: Implement registry members and expose the CustomElementRegistry interface on Window.
export const customElementRegistryIDL = defineInterface({
  name: 'CustomElementRegistry',
  implementation: impl(CustomElementRegistryImpl),
  members: [],
});
