import { bind } from '../../web-idl/index';
import {
  arg, attr, defineCallbackFunction, defineTypedef, idlType, nullable,
  reference, type AttributeMember, xattr,
} from '../../web-idl/declaration/index';
import type { EventTargetImpl } from '../dom/events/event-target';

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
        invoke: null,
        listener: null,
        type,
      });
    }
  }

  get(name: string): object | null {
    return this.#handlers.get(name)?.callback ?? null;
  }

  set(
    name: string,
    callback: object | null,
    invoke: EventHandlerInvocation,
  ): void {
    const handler = this.#handlers.get(name);
    if (!handler) throw new Error(`Unknown event handler ${name}`);

    if (callback === null) {
      this.#deactivate(handler);
      return;
    }

    handler.callback = callback;
    handler.invoke = invoke;
    this.#activate(handler);
  }

  #activate(handler: EventHandlerRecord): void {
    if (handler.listener !== null) return;

    handler.listener = (event) => {
      const callback = handler.callback;
      const invoke = handler.invoke;
      const currentTarget = event.currentTarget;
      if (callback === null || invoke === null || currentTarget === null) {
        return;
      }

      const result = invoke(callback, event, currentTarget);
      if (result === false) event.preventDefault();
    };
    this.#target.addEventListener(handler.type, handler.listener);
  }

  #deactivate(handler: EventHandlerRecord): void {
    handler.callback = null;
    handler.invoke = null;
    if (handler.listener === null) return;

    this.#target.removeEventListener(handler.type, handler.listener);
    handler.listener = null;
  }
}

export function eventHandlerAttr<Target extends object>(
  name: string,
  getEventHandlers: (target: Target) => EventHandlerMap,
): AttributeMember {
  return attr(name, reference('EventHandler'), bind({
    get() {
      return getEventHandlers(this as Target).get(name);
    },
    set(context, value) {
      getEventHandlers(this as Target).set(
        name,
        value as object | null,
        (callback, event, currentTarget) =>
          context.callbacks.invokeFunction(
            callback,
            [event],
            'report',
            currentTarget,
          ),
      );
    },
  }));
}

// -- Web IDL ------------------------------------------------------------

export const eventHandlerNonNullIDL = defineCallbackFunction({
  arguments: [arg('event', reference('Event'))],
  name: 'EventHandlerNonNull',
  returns: idlType.any,
  ...xattr('LegacyTreatNonObjectAsNull'),
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
  callback: object | null;
  invoke: EventHandlerInvocation | null;
  listener: EventListener | null;
  readonly type: string;
};

type EventHandlerInvocation = (
  callback: object,
  event: Event,
  currentTarget: EventTarget,
) => unknown;
