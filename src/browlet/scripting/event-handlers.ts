import {
  arg, attr, onError, defineCallbackFunction, defineTypedef, idlType,
  nullable, reference, type AttributeMember, xattr,
} from '../../web-idl/index';
import type { EventTargetImpl } from '../dom/events/event-target';
import type { EventImpl } from '../dom/events/event';

/*
 * [LegacyTreatNonObjectAsNull]
 * callback EventHandlerNonNull = any (Event event);
 * typedef EventHandlerNonNull? EventHandler;
 *
 * This module currently implements only event-handler IDL attributes. Content
 * attribute compilation, special error and beforeunload handlers, and the
 * body/frameset Window-target rules remain separate HTML integrations.
 */
export class EventHandlerMap {
  readonly #handlers = new Map<string, EventHandlerRecord>();
  readonly #target: EventTargetImpl;

  constructor(
    target: EventTargetImpl,
    handlers: readonly EventHandlerDefinition[],
  ) {
    this.#target = target;
    for (const { name, type } of handlers) {
      this.#handlers.set(name, {
        callback: null,
        listener: null,
        type,
      });
    }
  }

  get(name: string): EventHandlerCallback | null {
    return this.#handlers.get(name)?.callback ?? null;
  }

  set(name: string, callback: EventHandlerCallback | null): void {
    const handler = this.#handlers.get(name);
    if (!handler) throw new Error(`Unknown event handler ${name}`);

    if (callback === null) {
      this.#deactivate(handler);
      return;
    }

    handler.callback = callback;
    this.#activate(handler);
  }

  #activate(handler: EventHandlerRecord): void {
    if (handler.listener !== null) return;

    handler.listener = (event) => {
      const callback = handler.callback;
      const currentTarget = event.currentTarget;
      if (callback === null || currentTarget === null) {
        return;
      }

      const result: unknown = Reflect.apply(callback, currentTarget, [event]);
      if (result === false) event.preventDefault();
    };
    this.#target.addEventListener(handler.type, handler.listener);
  }

  #deactivate(handler: EventHandlerRecord): void {
    handler.callback = null;
    if (handler.listener === null) return;

    this.#target.removeEventListener(handler.type, handler.listener);
    handler.listener = null;
  }
}

export function eventHandlerAttr(
  name: string,
): AttributeMember {
  return attr(
    name,
    reference('EventHandler'),
    onError('report'),
  );
}

// -- Web IDL ------------------------------------------------------------

export const eventHandlerNonNullIDL = defineCallbackFunction({
  name: 'EventHandlerNonNull',
  ...xattr('LegacyTreatNonObjectAsNull'),
  returns: idlType.any,
  arguments: [arg('event', reference('Event'))],
});

export const eventHandlerIDL = defineTypedef({
  name: 'EventHandler',
  type: nullable(reference(eventHandlerNonNullIDL.name)),
});

type EventHandlerDefinition = {
  readonly name: string;
  readonly type: string;
};

type EventHandlerRecord = {
  callback: EventHandlerCallback | null;
  listener: ((this: EventTargetImpl, event: EventImpl) => void) | null;
  readonly type: string;
};

export type EventHandlerCallback = (
  this: EventTarget,
  event: Event,
) => unknown;
