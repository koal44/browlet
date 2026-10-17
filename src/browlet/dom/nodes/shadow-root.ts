import { InternalError } from '../../../infra/internal-error';
import {
  defineEnumeration, defineIncludes, defineInterface, idlType, impl, reference, roAttr,
} from '../../../web-idl/index';
import type { TreeScope, CSSStyleSheetImpl, StyleSheetListImpl } from '../../../stylelet/index';

import { EventHandlerMap, eventHandlerAttr, type EventHandlerCallback } from '../../scripting/index';
import type { EventImpl, EventTargetImpl } from '../events/index';
import type { DOMEnvironment } from '../environment';

import { DocumentFragmentImpl } from './document-fragment';
import type { ElementImpl } from './element';
import { NodeImpl } from './node';
import {
  DocumentOrShadowRootMixin, documentOrShadowRootIDL,
} from './document-or-shadow-root';
import type { CustomElementRegistryImpl } from './html/custom-elements/index';

/** Root of an element's shadow tree and its event propagation boundary. */
// https://dom.spec.whatwg.org/#interface-shadowroot
export class ShadowRootImpl extends DocumentFragmentImpl {
  /** Host element whose shadow tree this root contains. */
  declare host: ElementImpl;
  /** Whether the host exposes this root through its shadowRoot attribute. */
  mode: ShadowRootMode;
  /** Whether focusing the host delegates focus into its shadow tree. */
  delegatesFocus = false;
  /** Whether slots receive nodes by name or by explicit assignment. */
  slotAssignment: SlotAssignmentMode = 'named';
  /** Whether cloning the host also clones this shadow root. */
  clonable = false;
  /** Whether markup serialization may include this shadow root. */
  serializable = false;
  /** Whether a custom element can access this root through ElementInternals. */
  availableToElementInternals = false;
  /** Whether a parser-created root can be reused by attachShadow(). */
  declarative = false;
  /** Registry association used by adoption and element creation. */
  customElementRegistry: CustomElementRegistryImpl | null = null;
  /** Whether adoption must preserve an explicitly absent registry. */
  keepCustomElementRegistryNull = false;

  /** Focus and style-sheet behavior shared with documents. */
  #documentOrShadowRootMixin: DocumentOrShadowRootMixin;
  /** IDL handler registration shares the ordinary event listener ordering. */
  #eventHandlers = new EventHandlerMap(this, [{ name: 'onslotchange', type: 'slotchange' }]);

  constructor(host: ElementImpl, mode: ShadowRootMode, env: DOMEnvironment) {
    super(host.nodeDocument, host, env);
    this.mode = mode;
    this.#documentOrShadowRootMixin = new DocumentOrShadowRootMixin(this);
  }

  static is(value: unknown): value is ShadowRootImpl {
    return value instanceof ShadowRootImpl;
  }

  /** Handler for slot-change events bubbling through this root. */
  get onslotchange(): EventHandlerCallback | null {
    return this.#eventHandlers.get('onslotchange');
  }

  set onslotchange(callback: EventHandlerCallback | null) {
    this.#eventHandlers.set('onslotchange', callback);
  }

  /** Focused element visible within this shadow tree. */
  get activeElement(): ElementImpl | null {
    return this.#documentOrShadowRootMixin.activeElement;
  }

  get styleSheets(): StyleSheetListImpl {
    return this.#documentOrShadowRootMixin.styleSheets;
  }

  get adoptedStyleSheets(): CSSStyleSheetImpl[] {
    return this.#documentOrShadowRootMixin.adoptedStyleSheets;
  }

  set adoptedStyleSheets(styleSheets: CSSStyleSheetImpl[]) {
    this.#documentOrShadowRootMixin.adoptedStyleSheets = styleSheets;
  }

  /** Initialize or retrieve the style scope for this shadow tree. */
  getStyleScope(): TreeScope {
    // TODO: create and retain the shadow tree's style scope.
    throw new InternalError('Shadow-root style scopes are not implemented');
  }

  override getShadowRootHost(): ElementImpl {
    return this.host;
  }

  override getShadowRootMode(): ShadowRootMode {
    return this.mode;
  }

  /** Cross to the host unless this root bounds an uncomposed event's path. */
  // https://dom.spec.whatwg.org/#interface-shadowroot
  override getEventParent(event: EventImpl): EventTargetImpl | null {
    const firstTarget = event.path[0]?.invocationTarget ?? null;

    if (
      !event.composed &&
      NodeImpl.is(firstTarget) &&
      firstTarget.getRoot() === this
    ) {
      return null;
    }

    return this.host;
  }
}

/** Controls whether the host exposes its shadow root to authors. */
export type ShadowRootMode = 'open' | 'closed';

/*
 * enum ShadowRootMode { "open", "closed" };
 */
export const shadowRootModeIDL = defineEnumeration({
  name: 'ShadowRootMode',
  values: ['open', 'closed'] satisfies ShadowRootMode[],
});

/** Selects explicit slot assignment or matching by slot name. */
export type SlotAssignmentMode = 'manual' | 'named';

/*
 * enum SlotAssignmentMode { "manual", "named" };
 */
export const slotAssignmentModeIDL = defineEnumeration({
  name: 'SlotAssignmentMode',
  values: ['manual', 'named'] satisfies SlotAssignmentMode[],
});

/*
 * [Exposed=Window]
 * interface ShadowRoot : DocumentFragment {
 *   readonly attribute ShadowRootMode mode;
 *   readonly attribute boolean delegatesFocus;
 *   readonly attribute SlotAssignmentMode slotAssignment;
 *   readonly attribute boolean clonable;
 *   readonly attribute boolean serializable;
 *   readonly attribute Element host;
 *
 *   attribute EventHandler onslotchange;
 * };
 */
export const shadowRootIDL = defineInterface({
  name: 'ShadowRoot',
  inherits: 'DocumentFragment',
  exposed: 'Window',
  implementation: impl(ShadowRootImpl),
  members: [
    roAttr('mode', reference('ShadowRootMode')),
    roAttr('delegatesFocus', idlType.boolean),
    roAttr('slotAssignment', reference('SlotAssignmentMode')),
    roAttr('clonable', idlType.boolean),
    roAttr('serializable', idlType.boolean),
    roAttr('host', reference('Element')),
    eventHandlerAttr('onslotchange'),
  ],
});

/*
 * ShadowRoot includes DocumentOrShadowRoot;
 */
export const shadowRootIncludesDocumentOrShadowRootIDL = defineIncludes({
  interface: 'ShadowRoot',
  mixin: documentOrShadowRootIDL.name,
});
