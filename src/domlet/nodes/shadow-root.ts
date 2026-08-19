import { EventImpl } from '../events/event';
import type { EventTargetImpl } from '../events/event-target';
import { withShadowRootStub } from '../stubs/interfaces';
import {
  defineInterface, readonlyAttribute,
} from '../../web-idl/binding';
import {
  documentFragmentIDL, DocumentFragmentImpl,
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

export const shadowRootIDL = defineInterface({
  name: 'ShadowRoot',
  parent: documentFragmentIDL,
  exposed: ['Window'],
  members: {
    mode: readonlyAttribute(),
    delegatesFocus: readonlyAttribute(),
    slotAssignment: readonlyAttribute(),
    clonable: readonlyAttribute(),
    serializable: readonlyAttribute(),
    host: readonlyAttribute(),
    // EventHandler binding awaits the HTML event-handler infrastructure.
  },
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
    const host = DocumentFragmentImpl.getHost(this);
    if (!host) throw new Error('A shadow root must have a host');
    return host;
  }

  // -- Virtual ----------------------------------------------------------

  static readonly #eventTargetVirtuals = NodeImpl.createEventTargetVirtuals({
    getParent: (target, event) => ShadowRootImpl.is(target)
      ? ShadowRootImpl.getEventParent(target, event)
      : null,
    getShadowRootHost: (target) => ShadowRootImpl.is(target)
      ? target.host
      : null,
    getShadowRootMode: (target) => ShadowRootImpl.is(target)
      ? target.mode
      : null,
  });

  // -- Friends ----------------------------------------------------------

  static is(value: unknown): value is ShadowRootImpl {
    return NodeImpl.is(value) && #mode in value;
  }

  static getEventParent(
    root: ShadowRootImpl,
    event: Event,
  ): EventTargetImpl | null {
    const firstTarget = EventImpl.is(event)
      ? EventImpl.getFirstPathInvocationTarget(event)
      : null;

    if (
      !event.composed &&
      NodeImpl.is(firstTarget) &&
      firstTarget.getRootNode() === root
    ) {
      return null;
    }

    return root.host;
  }
}
