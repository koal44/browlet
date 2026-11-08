import { InternalError } from '../../infra/index';
import {
  arg, attr, defineCallbackFunction, defineTypedef, idlType,
  nullable, reference, union, type AttributeMember, type IDLCallbackFunctionValue, xattr,
} from '../../web-idl/core/index';

import { EventListenerCallback, type ErrorEventImpl, type EventTargetImpl, type EventImpl } from '../dom/events/index';
import type { DOMRealm } from '../dom/environment';
import type { BrowletEnvironment } from '../environment/index';

import type { BrowletRealm } from './realm';

/** Retains event-handler attributes and activates their corresponding listeners. */
// https://html.spec.whatwg.org/multipage/webappapis.html#event-handlers
export class EventHandlerMap {
  /** Shared name-to-event-type table; handler mutations must not change these definitions. */
  #definitions: Map<string, string>;
  /** Attribute names mapped to callbacks and their registered listeners. */
  #handlers = new Map<string, EventHandlerRecord>();
  #target: EventTargetImpl;

  constructor(target: EventTargetImpl, definitions: Map<string, string>) {
    this.#target = target;
    this.#definitions = definitions;
  }

  /** Realm recorded on the listener until its raw handler has been compiled. */
  get #uncompiledRealm(): DOMRealm {
    return this.#target.isNode() ? this.#target.nodeDocument.env.realm : this.#target.env.realm;
  }

  /** Resolve a stored callback, compiling raw source only when its value is needed. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#getting-the-current-value-of-the-event-handler
  get(name: string): EventHandlerCallback | null {
    const handler = this.#handlers.get(name);
    if (!handler) return null;
    if (handler.value === null || typeof handler.value === 'function') return handler.value;
    const target = this.#target;
    const element = target.isNode() && target.isElement() ? target : null;
    const document = element?.nodeDocument ?? (target.isWindow() ? target.getAssociatedDocument() : null);
    if (document === null) throw new InternalError('Raw handlers require an element or Window');
    if (document.browsingContext === null || document.activeSandboxingFlagSet.has('sandboxed-scripts')) return null;
    const form = element?.getFormOwner() ?? null;
    const env = document.getRelevantGlobalObject()!.env;
    try {
      handler.value = env.createEventHandler(name, handler.value.body, handler.value.filename, element, form);
      if (handler.listener !== null) handler.listener.realm = handler.value.realm;
    } catch (error) {
      if (!(error instanceof env.realm.SyntaxError)) throw error;
      // Parsing failure clears the value, not the listener or its registration order.
      handler.value = null;
      // TODO(HTML §8.1.4.6): ErrorEventImpl.extractErrorInformation() still lacks
      // source URL/line/column metadata; do not substitute host stack frames.
      env.reportException(error, false, null);
      return null;
    }
    return handler.value;
  }

  set(name: string, callback: EventHandlerCallback | null): void {
    const handler = this.#getOrCreate(name);

    if (callback === null) {
      this.#deactivate(handler);
      return;
    }

    handler.value = callback;
    // SPEC_CLASH(event-handler-current-event-realm): follow Chromium/WebKit's callback realm; Firefox uses the target realm.
    // Replacing the callback updates dispatch metadata without moving the listener.
    if (handler.listener !== null) handler.listener.realm = callback.realm;
    this.#activate(name, handler);
  }

  /** Whether the target exposes this handler name. */
  has(name: string): boolean {
    return this.#definitions.has(name);
  }

  /** Retain a CSP-allowed content attribute without parsing or executing its body. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#event-handler-content-attributes
  setSource(name: string, body: string, filename: string): void {
    const handler = this.#getOrCreate(name);
    handler.value = { body, filename };
    if (handler.listener !== null) handler.listener.realm = this.#uncompiledRealm;
    this.#activate(name, handler);
  }

  /** Adoption changes the future callback realm only while a handler remains uncompiled. */
  updateUncompiledRealm(realm: BrowletRealm): void {
    for (const handler of this.#handlers.values()) {
      if (handler.value !== null && typeof handler.value !== 'function' && handler.listener !== null) {
        handler.listener.realm = realm;
      }
    }
  }

  /** Reset every handler value and registration, preserving the supported handler names. */
  deactivateAll(): void {
    for (const handler of this.#handlers.values()) this.#deactivate(handler);
  }

  #getOrCreate(name: string): EventHandlerRecord {
    let handler = this.#handlers.get(name);
    if (handler) return handler;
    const type = this.#definitions.get(name);
    if (type === undefined) throw new InternalError(`Unknown event handler ${name}`);
    handler = { value: null, listener: null, type };
    this.#handlers.set(name, handler);
    return handler;
  }

  #activate(name: string, handler: EventHandlerRecord): void {
    if (handler.listener !== null) return;

    const listener = (event: EventImpl) => {
      const currentTarget = event.currentTarget;
      const env = this.#target.env as BrowletEnvironment;
      // The scripting gate precedes lazy parsing, including syntax-error reporting.
      if (!env.webDriverBiDiScriptingIsEnabled()) return;
      const callback = this.get(name);
      if (callback === null || currentTarget === null) {
        return;
      }

      // The callback declaration's adapter checks callback Document activity
      // before entering the author function.
      const specialErrorHandling = isSpecialErrorEvent(event);
      const result: unknown = Reflect.apply(callback, currentTarget, [event]);
      if (event.isBeforeUnloadEvent() && event.type === 'beforeunload') {
        // Binding supplies a nullable DOMString; a skipped or failed invocation has no result.
        if (typeof result === 'string') {
          event.preventDefault();
          if (event.returnValue === '') event.returnValue = result;
        }
      } else if (specialErrorHandling ? result === true : result === false) {
        event.preventDefault();
      }
    };
    const realm = typeof handler.value === 'function' ? handler.value.realm : this.#uncompiledRealm;
    handler.listener = new EventListenerCallback(listener, realm, listener);
    this.#target.addEventListener(handler.type, handler.listener);
  }

  #deactivate(handler: EventHandlerRecord): void {
    handler.value = null;
    if (handler.listener === null) return;

    this.#target.removeEventListener(handler.type, handler.listener);
    handler.listener = null;
  }
}

/** Declare an event-handler attribute using the shared HTML callback contract. */
export function eventHandlerAttr(name: string): AttributeMember {
  return attr(name, reference('EventHandler'));
}

/** Bind a handler directly to the target's map, including body/frameset forwarding. */
export function eventHandlerMapAttr(name: string, callbackType = 'EventHandler'): AttributeMember {
  return attr(name, reference(callbackType), {
    overrideGet() {
      return (this as EventTargetImpl).getEventHandlerTarget(name)?.eventHandlers?.get(name) ?? null;
    },
    overrideSet(_env, value) {
      (this as EventTargetImpl).getEventHandlerTarget(name)?.eventHandlers?.set(name, value as EventHandlerCallback | null);
    },
  });
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

/*
 * [LegacyTreatNonObjectAsNull]
 * callback OnBeforeUnloadEventHandlerNonNull = DOMString? (Event event);
 * typedef OnBeforeUnloadEventHandlerNonNull? OnBeforeUnloadEventHandler;
 */
export const onBeforeUnloadEventHandlerNonNullIDL = defineCallbackFunction<BrowletEnvironment>({
  name: 'OnBeforeUnloadEventHandlerNonNull',
  ...xattr('LegacyTreatNonObjectAsNull'),
  // SPEC_CLASH(beforeunload-plain-event-conversion): follow HTML/Chromium/Firefox; WebKit skips result conversion for a plain Event.
  returns: nullable(idlType.DOMString),
  arguments: [arg('event', reference('Event'))],
  overrideCbConversion: createEventHandlerCallback,
});

export const onBeforeUnloadEventHandlerIDL = defineTypedef({
  name: 'OnBeforeUnloadEventHandler',
  type: nullable(reference(onBeforeUnloadEventHandlerNonNullIDL.name)),
});

type EventHandlerRecord = {
  /** Converted callback, internal raw uncompiled handler, or inactive value. */
  // TODO(HTML parser source locations): Retain attribute line/column when supplied
  // by the tokenizer. DOM attribute setters currently supply the Document URL.
  value: EventHandlerCallback | { body: string; filename: string; } | null;
  /** Stable listener registered while the attribute has a callback. */
  listener: EventListenerCallback | null;
  /** Event type used to register and remove the listener. */
  type: string;
};

/** Converted callback invoked with implementation identities by event dispatch. */
export type EventHandlerCallback = ((
  this: EventTargetImpl,
  event: EventImpl,
) => unknown) & {
  /** Author callback realm supplied by Binding; absent for direct internal callbacks. */
  realm?: BrowletRealm;
};

// https://html.spec.whatwg.org/multipage/webappapis.html#the-event-handler-processing-algorithm
// Binding retains the callback's own realm; invocation supplies the actual handler target.
// The implementation receives one Event; the adapter selects the author arguments.
function createEventHandlerCallback(
  _env: BrowletEnvironment,
  callback: IDLCallbackFunctionValue<BrowletRealm>,
): EventHandlerCallback {
  return Object.assign(function(this: EventTargetImpl, event: EventImpl): unknown {
    const realm = callback.realm;
    if (realm.isWindow() && !realm.getAssociatedDocument().isFullyActive()) return;
    const argumentsList = isSpecialErrorEvent(event)
      ? [event.message, event.filename, event.lineno, event.colno, event.error]
      : [event];
    // Report in the callback realm, as DOM dispatch does for EventListener.
    // Web IDL requires rethrow for the nullable-string callback. The adapter
    // contains invocation/conversion failures before the map applies return-value rules.
    try {
      return callback.invoke(argumentsList, 'rethrow', this);
    } catch (exception) {
      realm.reportException(exception);
    }
  }, { realm: callback.realm });
}

// HTML's special case requires the event interface, event type, and current target.
function isSpecialErrorEvent(event: EventImpl): event is ErrorEventImpl {
  const target = event.currentTarget;
  return event.isErrorEvent() && event.type === 'error' && target !== null &&
    (target.isWindow() || target.isWorkerGlobal());
}
