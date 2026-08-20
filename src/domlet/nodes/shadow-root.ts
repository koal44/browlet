import { EventImpl } from '../events/event';
import type { EventTargetImpl } from '../events/event-target';
import { withShadowRootStub } from '../stubs/interfaces';
import {
  defineEnumeration, defineInterface, idlType, reference,
} from '../../web-idl/definition';
import {
  DocumentFragmentImpl,
} from './document-fragment';
import type { ElementImpl } from './element';
import { NodeImpl } from './node';

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
 *
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

export const shadowRootIDL = defineInterface({
  exposed: ['Window'],
  inherits: 'DocumentFragment',
  members: [
    {
      kind: 'attribute', name: 'mode', readonly: true,
      type: reference('ShadowRootMode'),
    },
    {
      kind: 'attribute', name: 'delegatesFocus', readonly: true,
      type: idlType.boolean,
    },
    {
      kind: 'attribute', name: 'slotAssignment', readonly: true,
      type: reference('SlotAssignmentMode'),
    },
    { kind: 'attribute', name: 'clonable', readonly: true, type: idlType.boolean },
    {
      kind: 'attribute', name: 'serializable', readonly: true,
      type: idlType.boolean,
    },
    {
      kind: 'attribute', name: 'host', readonly: true,
      type: reference('Element'),
    },
    // EventHandler binding awaits the HTML event-handler infrastructure.
  ],
  name: 'ShadowRoot',
});

export class ShadowRootImpl
  extends withShadowRootStub(DocumentFragmentImpl)
  implements ShadowRoot
{
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
    event: Event,
  ): EventTargetImpl | null {
    const firstTarget = EventImpl.is(event)
      ? EventImpl.getFirstPathInvocationTarget(event)
      : null;
    const composed = EventImpl.is(event)
      ? EventImpl.isComposed(event)
      : event.composed;

    if (
      !composed &&
      NodeImpl.is(firstTarget) &&
      NodeImpl.getRootNode(firstTarget) === root
    ) {
      return null;
    }

    return ShadowRootImpl.getHost(root);
  }
}
