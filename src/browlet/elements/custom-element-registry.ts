import { withCustomElementRegistryStub } from '../stubs/interfaces';

/*
 * HTML creates a distinct CustomElementRegistry for each initial Document.
 * Its definition and upgrade algorithms enter with the custom-elements
 * section; this class preserves the actor and its identity in the meantime.
 */
export class CustomElementRegistryImpl
  extends withCustomElementRegistryStub(class {})
  implements CustomElementRegistry {}
