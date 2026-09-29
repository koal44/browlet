import type { EventImpl } from '../events/event';
import type { EventTargetImpl } from '../events/event-target';
import {
  defineEnumeration, defineIncludes, defineInterface, idlType, impl, reference, roAttr,
} from '../../../web-idl/index';
import { DocumentFragmentImpl } from './document-fragment';
import type { ElementImpl } from './element';
import type { CSSStyleSheetImpl, StyleSheetListImpl } from '../../../stylelet/index';
import type { CustomElementRegistryImpl } from '../../html/custom-elements/registry';
import { NodeImpl } from './node';
import {
  DocumentOrShadowRootMixin, documentOrShadowRootIDL,
} from './document-or-shadow-root';
import { InternalError } from '../../../infra/internal-error';
import type { DOMEnvironment } from '../environment';

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

  /** Registry and style-sheet behavior shared with documents. */
  #documentOrShadowRootMixin: DocumentOrShadowRootMixin;

  constructor(host: ElementImpl, mode: ShadowRootMode, env: DOMEnvironment) {
    super(host.nodeDocument, host, env);
    this.mode = mode;
    this.#documentOrShadowRootMixin = new DocumentOrShadowRootMixin({
      getCustomElementRegistry: () => null,
      getStyleScope() {
        throw new InternalError('Shadow-root style scopes are not implemented');
      },
    });
  }

  static is(value: unknown): value is ShadowRootImpl {
    return value instanceof ShadowRootImpl;
  }

  get customElementRegistry(): CustomElementRegistryImpl | null {
    return this.#documentOrShadowRootMixin.customElementRegistry;
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

  // -- Internal ---------------------------------------------------------

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

/*
 * enum ShadowRootMode { "open", "closed" };
 */
export const shadowRootModeIDL = defineEnumeration({
  name: 'ShadowRootMode',
  values: ['open', 'closed'],
});

/*
 * enum SlotAssignmentMode { "manual", "named" };
 */
export const slotAssignmentModeIDL = defineEnumeration({
  name: 'SlotAssignmentMode',
  values: ['manual', 'named'],
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
    // EventHandler binding awaits the HTML event-handler infrastructure.
  ],
});

/*
 * ShadowRoot includes DocumentOrShadowRoot;
 */
export const shadowRootIncludesDocumentOrShadowRootIDL = defineIncludes({
  interface: 'ShadowRoot',
  mixin: documentOrShadowRootIDL.name,
});
