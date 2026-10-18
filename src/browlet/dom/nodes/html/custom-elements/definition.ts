import type { ElementImpl } from '../../element';

/** Definition state consumed by HTML element construction. */
// https://html.spec.whatwg.org/multipage/custom-elements.html#custom-element-definition
// TODO(HTML): define() must populate these records after validation. Lifecycle callbacks,
// observed attributes, disable-internals/shadow, and form association belong to that slice.
export type CustomElementDefinition = {
  /** Registered custom-element name, such as "x-button". */
  name: string;
  /** Element's local name: the registered name for autonomous elements, or a built-in name such as "button". */
  localName: string;
  /** Author constructor identity; definition must establish that it is constructible. */
  constructor: object;
  /**
   * Upgrade pushes an existing element; the HTML constructor replaces it with the marker.
   * Upgrade pops the entry afterward, including when construction throws.
   */
  constructionStack: (ElementImpl | typeof alreadyConstructed)[];
};

/** Marks an upgrade element whose superclass constructor has already run. */
// https://html.spec.whatwg.org/multipage/custom-elements.html#concept-already-constructed-marker
export const alreadyConstructed = Symbol('already constructed');
