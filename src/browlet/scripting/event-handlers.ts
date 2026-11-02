import { InternalError } from '../../infra/index';
import {
  arg, attr, defineCallbackFunction, defineTypedef, idlType,
  nullable, reference, union, type AttributeMember, type IDLCallbackFunctionValue, xattr,
} from '../../web-idl/core/index';

import type { ErrorEventImpl, EventTargetImpl, EventImpl } from '../dom/events/index';
import type { BrowletEnvironment } from '../environment/index';

import type { BrowletRealm } from './realm';

// TODO(HTML §8.1.8.1): Add raw content-attribute values/lazy compilation,
// beforeunload processing, body/frameset target forwarding, and
// erase-all-handlers. ROADMAP.md records the algorithms and concrete owners.
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

      // The callback declaration's adapter checks target policy and callback
      // Document activity before entering the author function.
      const specialErrorHandling = isSpecialErrorEvent(event);
      const result: unknown = Reflect.apply(callback, currentTarget, [event]);
      if (specialErrorHandling ? result === true : result === false) event.preventDefault();
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

/** Declare an event-handler attribute using the shared HTML callback contract. */
export function eventHandlerAttr(name: string): AttributeMember {
  return attr(name, reference('EventHandler'));
}

/*
 * [LegacyTreatNonObjectAsNull]
 * callback EventHandlerNonNull = any (Event event);
 */
export const eventHandlerNonNullIDL = defineCallbackFunction<BrowletEnvironment>({
  name: 'EventHandlerNonNull',
  ...xattr('LegacyTreatNonObjectAsNull'),
  returns: idlType.any,
  arguments: [arg('event', reference('Event'))],
  overrideCbConversion: createEventHandlerCallback,
});

/*
 * typedef EventHandlerNonNull? EventHandler;
 */
export const eventHandlerIDL = defineTypedef({
  name: 'EventHandler',
  type: nullable(reference(eventHandlerNonNullIDL.name)),
});

/*
 * [LegacyTreatNonObjectAsNull]
 * callback OnErrorEventHandlerNonNull = any ((Event or DOMString) event, optional DOMString source,
 *   optional unsigned long lineno, optional unsigned long colno, optional any error);
 * typedef OnErrorEventHandlerNonNull? OnErrorEventHandler;
 */
export const onErrorEventHandlerNonNullIDL = defineCallbackFunction<BrowletEnvironment>({
  name: 'OnErrorEventHandlerNonNull',
  ...xattr('LegacyTreatNonObjectAsNull'),
  returns: idlType.any,
  arguments: [
    arg('event', union(reference('Event'), idlType.DOMString)),
    arg('source', idlType.DOMString, { optional: true }),
    arg('lineno', idlType.unsignedLong, { optional: true }),
    arg('colno', idlType.unsignedLong, { optional: true }),
    arg('error', idlType.any, { optional: true }),
  ],
  overrideCbConversion: createEventHandlerCallback,
});

export const onErrorEventHandlerIDL = defineTypedef({
  name: 'OnErrorEventHandler',
  type: nullable(reference(onErrorEventHandlerNonNullIDL.name)),
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

/** Converted callback invoked with implementation identities by event dispatch. */
export type EventHandlerCallback = (
  this: EventTargetImpl,
  event: EventImpl,
) => unknown;

// https://html.spec.whatwg.org/multipage/webappapis.html#the-event-handler-processing-algorithm
// Binding retains the receiving target's environment and the callback's own realm.
// The implementation receives one Event; the adapter selects the author arguments.
function createEventHandlerCallback(
  env: BrowletEnvironment,
  callback: IDLCallbackFunctionValue<BrowletRealm>,
): EventHandlerCallback {
  return function(this: EventTargetImpl, event: EventImpl): unknown {
    if (!env.userAgent.webDriverBiDiScriptingIsEnabled(env)) return;
    const realm = callback.realm;
    if (realm.isWindow() && !realm.getAssociatedDocument().isFullyActive()) return;
    const argumentsList = isSpecialErrorEvent(event)
      ? [event.message, event.filename, event.lineno, event.colno, event.error]
      : [event];
    // Report in the callback realm, as DOM dispatch does for EventListener.
    // The adapter contains the exception before the map applies return-value rules.
    return callback.invoke(argumentsList, 'report', this);
  };
}

// HTML's special case requires the event interface, event type, and current target.
function isSpecialErrorEvent(event: EventImpl): event is ErrorEventImpl {
  // TODO(HTML §9): Include WorkerGlobalScope when its EventTarget implementation exists.
  return event.isErrorEvent() && event.type === 'error' && event.currentTarget?.isWindow() === true;
}
