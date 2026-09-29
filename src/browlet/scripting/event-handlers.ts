import {
  arg, attr, onError, defineCallbackFunction, defineTypedef, idlType,
  nullable, reference, type AttributeMember, xattr,
} from '../../web-idl/index';
import type { EventTargetImpl } from '../dom/events/event-target';
import type { EventImpl } from '../dom/events/event';
import { InternalError } from '../../infra/internal-error';

// Content attributes, special error/beforeunload handlers, and body/frameset
// Window-target rules await their HTML integrations.
/** Retains event-handler attributes and activates their corresponding listeners. */
// https://html.spec.whatwg.org/multipage/webappapis.html#event-handlers
export class EventHandlerMap {
  /** Attribute names mapped to callbacks and their registered listeners. */
  #handlers = new Map<string, EventHandlerRecord>();
  #target: EventTargetImpl;

  constructor(
    target: EventTargetImpl,
    handlers: EventHandlerDefinition[],
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
    if (!handler) throw new InternalError(`Unknown event handler ${name}`);

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

/** Declare an event-handler attribute with Web IDL's exception-reporting policy. */
export function eventHandlerAttr(
  name: string,
): AttributeMember {
  return attr(
    name,
    reference('EventHandler'),
    onError('report'),
  );
}

/*
 * [LegacyTreatNonObjectAsNull]
 * callback EventHandlerNonNull = any (Event event);
 */
export const eventHandlerNonNullIDL = defineCallbackFunction({
  name: 'EventHandlerNonNull',
  ...xattr('LegacyTreatNonObjectAsNull'),
  returns: idlType.any,
  arguments: [arg('event', reference('Event'))],
});

/*
 * typedef EventHandlerNonNull? EventHandler;
 */
export const eventHandlerIDL = defineTypedef({
  name: 'EventHandler',
  type: nullable(reference(eventHandlerNonNullIDL.name)),
});

type EventHandlerDefinition = {
  /** IDL attribute name, such as onload. */
  name: string;
  /** Event type dispatched to this handler, such as load. */
  type: string;
};

type EventHandlerRecord = {
  /** Converted callback currently stored in the event-handler attribute. */
  callback: EventHandlerCallback | null;
  /** Stable listener registered while the attribute has a callback. */
  listener: ((this: EventTargetImpl, event: EventImpl) => void) | null;
  /** Event type used to register and remove the listener. */
  type: string;
};

export type EventHandlerCallback = (
  this: EventTarget,
  event: Event,
) => unknown;
