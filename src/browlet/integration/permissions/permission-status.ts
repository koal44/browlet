import { atArg, defineInterface, idlType, impl, reference, roAttr } from '../../../web-idl/core/index';
import {
  defaultPermissionState, type PermissionDescriptor, type PermissionState, type PermissionStatusData,
} from '../../../permissions/index';

import { EventTargetImpl } from '../../dom/events/index';
import { EventHandlerMap, eventHandlerAttr, type EventHandlerCallback } from '../../scripting/index';
import type { BrowletEnvironment } from '../../environment/index';

/** The query result, using DOM's real EventTarget implementation. */
// https://w3c.github.io/permissions/#permissionstatus-interface
export class PermissionStatusImpl extends EventTargetImpl implements PermissionStatusData {
  /** Supported handler names shared by all permission statuses. */
  static #handlerDefinitions = new Map([['onchange', 'change']]);

  /** Settings for this result's realm and change notifications. */
  declare env: BrowletEnvironment;
  /** Initialized by createPermissionStatus before the result can be exposed. */
  query!: PermissionDescriptor;
  /** Initialized with the query; retained independently of later descriptor mutation. */
  name!: string;
  /** Latest state set by the feature's permission query algorithm. */
  state: PermissionState = defaultPermissionState;
  /** The onchange attribute shares the ordinary listener list and its retention rules. */
  override eventHandlers: EventHandlerMap = new EventHandlerMap(this, PermissionStatusImpl.#handlerDefinitions);

  constructor(env: BrowletEnvironment) {
    super(env);
  }

  get onchange(): EventHandlerCallback | null { return this.eventHandlers.get('onchange'); }
  set onchange(callback: EventHandlerCallback | null) { this.eventHandlers.set('onchange', callback); }

  /** Refresh asynchronously; only a changed effective state queues a trusted change event. */
  // https://w3c.github.io/permissions/#dom-permissionstatus-onchange
  queueUpdate(): void {
    this.env.runInParallel(() => {
      if (this.env.isWindow && !this.env.isAssociatedDocumentFullyActive()) return;
      try {
        const previous = this.state;
        this.env.permissions.runPermissionQuery(this.query, this);
        if (this.state === previous) return;
        this.env.queueTask('permissions', () => { this.fireEvent('change'); });
      } catch (error) {
        this.env.realm.reportException(error);
      }
    });
  }

  /** Keep listening results alive with their global, including onchange, once, and AbortSignal removal. */
  // https://w3c.github.io/permissions/#garbage-collection
  protected override eventListenerListChanged(type: string): void {
    if (type !== 'change') return;
    const retained = this.env.getWindowOrWorkerGlobalScopeMixin().permissionStatuses;
    if (this.hasEventListener('change')) retained.add(this);
    else retained.delete(this);
  }
}

/*
 * [Exposed=(Window,Worker)]
 * interface PermissionStatus : EventTarget {
 *   readonly attribute PermissionState state;
 *   readonly attribute DOMString name;
 *   attribute EventHandler onchange;
 * };
 */
export const permissionStatusIDL = defineInterface<BrowletEnvironment>({
  name: 'PermissionStatus',
  inherits: 'EventTarget',
  exposed: ['Window', 'Worker'],
  implementation: impl(PermissionStatusImpl, { constructWith: [atArg(0, (env) => env)] }),
  members: [roAttr('state', reference('PermissionState')), roAttr('name', idlType.DOMString), eventHandlerAttr('onchange')],
});
