import type { DocumentImpl } from '../../document';

/** Lifecycle callback arguments used by DOM mutation and custom-element reactions. */
// https://html.spec.whatwg.org/multipage/custom-elements.html#enqueue-a-custom-element-callback-reaction
export type CustomElementCallbackArguments = {
  connectedCallback: [];
  disconnectedCallback: [];
  connectedMoveCallback: [];
  adoptedCallback: [oldDocument: DocumentImpl, document: DocumentImpl];
  attributeChangedCallback: [name: string, oldValue: string | null, value: string | null, namespace: string | null];
};
