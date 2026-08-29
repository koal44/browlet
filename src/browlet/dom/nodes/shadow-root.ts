import { EventImpl } from '../events/event';
import type { EventTargetImpl } from '../events/event-target';
import { withShadowRootStub } from '../../stubs';
import {
  defineEnumeration, defineIncludes, defineInterface, idlType,
  roAttr, reference,
} from '../../../web-idl/declaration/index';
import { impl } from '../../../web-idl/index';
import {
  DocumentFragmentImpl,
} from './document-fragment';
import type { ElementImpl } from './element';
import type { CustomElementRegistryImpl } from '../../html/custom-elements/registry';
import { NodeImpl } from './node';
import {
  DocumentOrShadowRootMixin, documentOrShadowRootIDL,
} from './document-or-shadow-root';

/*
 * enum ShadowRootMode { "open", "closed" };
 * enum SlotAssignmentMode { "manual", "named" };
 */

export const shadowRootModeIDL = defineEnumeration({
  name: 'ShadowRootMode',
  values: ['open', 'closed'],
});

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
 * ShadowRoot includes DocumentOrShadowRoot;
 */
export class ShadowRootImpl
  extends withShadowRootStub(DocumentFragmentImpl)
  implements ShadowRoot
{
  readonly #documentOrShadowRootMixin: DocumentOrShadowRootMixin;
  readonly #mode: ShadowRootMode;

  constructor(host: ElementImpl, mode: ShadowRootMode) {
    const document = NodeImpl.getNodeDocument(host);
    if (!document) throw new Error('A shadow host must have a node document');

    super(
      document,
      host,
      ShadowRootImpl.#eventTargetVirtuals,
    );
    this.#mode = mode;
    this.#documentOrShadowRootMixin = new DocumentOrShadowRootMixin({
      getCustomElementRegistry: () => null,
      getStyleScope() {
        throw new Error('Shadow-root style scopes are not implemented');
      },
    });
  }

  get mode(): ShadowRootMode {
    return this.#mode;
  }

  get delegatesFocus(): boolean {
    return false;
  }

  get slotAssignment(): SlotAssignmentMode {
    return 'named';
  }

  get clonable(): boolean {
    return false;
  }

  get serializable(): boolean {
    return false;
  }

  get host(): ElementImpl {
    return ShadowRootImpl.getHost(this);
  }

  get customElementRegistry(): CustomElementRegistryImpl | null {
    return this.#documentOrShadowRootMixin.customElementRegistry;
  }

  get styleSheets(): StyleSheetList {
    return this.#documentOrShadowRootMixin.styleSheets;
  }

  get adoptedStyleSheets(): CSSStyleSheet[] {
    return this.#documentOrShadowRootMixin.adoptedStyleSheets;
  }

  set adoptedStyleSheets(styleSheets: CSSStyleSheet[]) {
    this.#documentOrShadowRootMixin.adoptedStyleSheets = styleSheets;
  }

  // -- Virtual ----------------------------------------------------------

  static readonly #eventTargetVirtuals = NodeImpl.createEventTargetVirtuals({
    getParent: (target, event) => ShadowRootImpl.is(target)
      ? ShadowRootImpl.getEventParent(target, event)
      : null,
    getShadowRootHost: (target) => ShadowRootImpl.is(target)
      ? ShadowRootImpl.getHost(target)
      : null,
    getShadowRootMode: (target) => ShadowRootImpl.is(target)
      ? ShadowRootImpl.getMode(target)
      : null,
  });

  // -- Friends ----------------------------------------------------------

  static is(value: unknown): value is ShadowRootImpl {
    return NodeImpl.is(value) && #mode in value;
  }

  static getHost(root: ShadowRootImpl): ElementImpl {
    const host = DocumentFragmentImpl.getHost(root);
    if (!host) throw new Error('A shadow root must have a host');
    return host;
  }

  static getMode(root: ShadowRootImpl): ShadowRootMode {
    return root.#mode;
  }

  static getEventParent(
    root: ShadowRootImpl,
    event: EventImpl,
  ): EventTargetImpl | null {
    const firstTarget = EventImpl.getFirstPathInvocationTarget(event);

    if (
      !EventImpl.isComposed(event) &&
      NodeImpl.is(firstTarget) &&
      NodeImpl.getRootNode(firstTarget) === root
    ) {
      return null;
    }

    return ShadowRootImpl.getHost(root);
  }
}

// -- Web IDL ------------------------------------------------------------

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

export const shadowRootIncludesDocumentOrShadowRootIDL = defineIncludes({
  interface: 'ShadowRoot',
  mixin: documentOrShadowRootIDL.name,
});
