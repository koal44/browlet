import type { EventImpl } from '../events/event';
import type { EventTargetImpl } from '../events/event-target';
import { withShadowRootStub } from '../../stubs';
import {
  defineEnumeration, defineIncludes, defineInterface, idlType,
  roAttr, reference,
} from '../../../web-idl/declaration/index';
import { impl } from '../../../web-idl/index';
import { DocumentFragmentImpl } from './document-fragment';
import type { ElementImpl } from './element';
import type { CSSStyleSheetImpl } from '../../../stylelet/cssom/css-stylesheet';
import type { StyleSheetListImpl } from '../../../stylelet/cssom/stylesheet-list';
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
export class ShadowRootImpl extends withShadowRootStub(DocumentFragmentImpl) {
  readonly #documentOrShadowRootMixin: DocumentOrShadowRootMixin;
  readonly #mode: ShadowRootMode;

  static readonly #eventTargetVirtuals = NodeImpl.createEventTargetVirtuals({
    getParent: (target, event) => ShadowRootImpl.is(target)
      ? target.getEventParent(event)
      : null,
    getShadowRootHost: (target) => ShadowRootImpl.is(target)
      ? target.host
      : null,
    getShadowRootMode: (target) => ShadowRootImpl.is(target)
      ? target.mode
      : null,
  });

  constructor(host: ElementImpl, mode: ShadowRootMode) {
    const document = host.getNodeDocument();
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

  static is(value: unknown): value is ShadowRootImpl {
    return NodeImpl.is(value) && #mode in value;
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
    const host = super.getHost();
    if (!host) throw new Error('A shadow root must have a host');
    return host;
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

  override getEventParent(event: EventImpl): EventTargetImpl | null {
    const firstTarget = event.getFirstPathInvocationTarget();

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
