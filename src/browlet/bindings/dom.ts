import type { AssembledInterface } from '../../web-idl/assembly';
import {
  callUserObjectOperation as callWebIDLUserObjectOperation,
} from '../../web-idl/callback';
import {
  isCallbackInterfaceValue, type CallbackInterfaceValue,
} from '../../web-idl/callback-value';
import { convertToIDL } from '../../web-idl/conversion';
import {
  registerDOMExceptionImplementations,
} from '../../web-idl/dom-exception';
import type {
  ImplementationConstructor, ImplementationRegistry,
  InterfaceImplementationOptions,
} from '../../web-idl/implementation';
import { registerInterfaceImplementation } from '../../web-idl/implementation';
import type { JavaScriptBinding } from '../../web-idl/binding';
import {
  CustomEventImpl, EventImpl,
} from '../../domlet/events/event';
import {
  EventTargetImpl, type EventImplementationConstructor,
  type EventListenerCallback, type EventListenerInvocationHost,
} from '../../domlet/events/event-target';
import { CharacterDataImpl } from '../../domlet/nodes/character-data';
import { CommentImpl } from '../../domlet/nodes/comment';
import { DocumentImpl } from '../../domlet/nodes/document';
import { DocumentTypeImpl } from '../../domlet/nodes/document-type';
import {
  ElementImpl, HTMLElementImpl, HTMLHeadElementImpl, HTMLLinkElementImpl,
  HTMLStyleElementImpl, MathMLElementImpl, SVGElementImpl, SVGStyleElementImpl,
} from '../../domlet/nodes/element';
import type { DOMNodeFactory } from '../../domlet/nodes/factory';
import { NodeImpl } from '../../domlet/nodes/node';
import { TextImpl } from '../../domlet/nodes/text';
import type { Realm } from '../realm';

export class DOMBinding
implements DOMNodeFactory, EventListenerInvocationHost
{
  readonly #binding: JavaScriptBinding;
  readonly #host: Realm;
  readonly #implementations = new Map<
    ImplementationConstructor<object>,
    AssembledInterface
  >();

  constructor(host: Realm, binding: JavaScriptBinding) {
    this.#host = host;
    if (binding.realm !== host) {
      throw new TypeError('DOM bindings and host must use the same realm');
    }
    const implementations = binding.implementations;
    this.#binding = binding;

    this.#registerImplementations(implementations);
    registerDOMExceptionImplementations(implementations, host);
  }

  createEvent(
    eventConstructor: EventImplementationConstructor = EventImpl,
  ): EventImpl {
    const event = this.#construct(
      eventConstructor,
      ['', {}, this.#host.eventTimeStamp()],
      this.#requireInterface('Event'),
    );
    EventImpl.setTrusted(event, true);
    return event;
  }

  createDOMException(message = '', name = 'Error'): DOMException {
    const DOMException_ = this.#binding.getInterfaceObject(
      'DOMException',
    ) as unknown as typeof DOMException;
    return new DOMException_(message, name);
  }

  getAssociatedGlobal(
    callback: EventListenerCallback,
  ): object {
    return requireEventListenerValue(callback).realm.global;
  }

  convertEventListener(
    callback: EventListenerCallback,
  ): CallbackInterfaceValue {
    if (isCallbackInterfaceValue(callback)) return callback;
    const value = convertToIDL(
      callback,
      { kind: 'reference', name: 'EventListener' },
      this.#binding,
    );
    return requireEventListenerValue(value);
  }

  isWindow(
    global: object,
    callback: EventListenerCallback,
  ): boolean {
    return this.#getCallbackHost(callback).isWindow(global);
  }

  getCurrentEvent(
    global: object,
    callback: EventListenerCallback,
  ): Event | undefined {
    return this.#getCallbackHost(callback).getCurrentEvent(global);
  }

  setCurrentEvent(
    global: object,
    event: Event | undefined,
    callback: EventListenerCallback,
  ): void {
    this.#getCallbackHost(callback).setCurrentEvent(global, event);
  }

  recordTimingInfo(
    global: object,
    event: Event,
    callback: EventListenerCallback,
  ): void {
    this.#getCallbackHost(callback).recordTimingInfo(
      global,
      event,
      requireEventListenerValue(callback).object as
        EventListenerOrEventListenerObject,
    );
  }

  callUserObjectOperation(
    callback: EventListenerCallback,
    operation: 'handleEvent',
    [event]: readonly [Event],
    thisArgument: EventTarget,
  ): void {
    callWebIDLUserObjectOperation(
      requireEventListenerValue(callback),
      operation,
      [event],
      this.#binding,
      thisArgument,
    );
  }

  reportException(
    exception: unknown,
    callback: EventListenerCallback,
  ): void {
    requireEventListenerValue(callback).realm.callbacks
      .reportException(exception);
  }

  associateEventTarget(target: EventTargetImpl): void {
    EventTargetImpl.associateInvocationHost(target, this);
  }

  construct<T extends object>(
    implementation: ImplementationConstructor<T>,
    argumentsList: readonly unknown[],
  ): T {
    const interface_ = this.#implementations.get(implementation);
    if (!interface_) {
      return Reflect.construct(implementation, argumentsList) as T;
    }
    return this.#construct(implementation, argumentsList, interface_);
  }

  #getCallbackHost(callback: EventListenerCallback): DOMEventRealmHost {
    const realm = requireEventListenerValue(callback).realm;
    return isDOMEventRealmHost(realm) ? realm : this.#host;
  }

  #normalizeException(exception: unknown): unknown {
    const interface_ = this.#requireInterface('DOMException');
    if (this.#binding.implements(exception, interface_)) return exception;
    return exception instanceof DOMException
      ? this.createDOMException(exception.message, exception.name)
      : exception;
  }

  #requireInterface(name: string): AssembledInterface {
    const interface_ = this.#binding.definitions.getInterface(name);
    if (!interface_) throw new Error(`Missing DOM interface ${name}`);
    return interface_;
  }

  #construct<T extends object>(
    implementation: ImplementationConstructor<T>,
    argumentsList: readonly unknown[],
    interface_: AssembledInterface,
  ): T {
    const value = Reflect.construct(
      implementation,
      argumentsList,
      this.#binding.getInterfaceObject(interface_),
    ) as T;
    const record = this.#binding.projectPlatformObject(value, interface_);
    if (EventTargetImpl.is(value)) this.associateEventTarget(value);
    return record.object as T;
  }

  #registerImplementations(registry: ImplementationRegistry): void {
    const registrations: DOMImplementationRegistration[] = [
      {
        implementation: EventTargetImpl,
        name: 'EventTarget',
        options: {
          construct() {},
          create: {
            created: (value) => {
              this.associateEventTarget(value as EventTargetImpl);
            },
          },
        },
      },
      {
        implementation: EventImpl,
        name: 'Event',
        options: {
          construct(type, init) {
            const dictionary = asDictionary(init);
            EventImpl.initializeForBinding(
              this as EventImpl,
              type as string,
              Boolean(dictionary.bubbles),
              Boolean(dictionary.cancelable),
              Boolean(dictionary.composed),
            );
          },
          create: {
            arguments: () => ['', {}, this.#host.eventTimeStamp()],
          },
        },
      },
      {
        implementation: CustomEventImpl,
        name: 'CustomEvent',
        options: {
          construct(type, init) {
            const dictionary = asDictionary(init);
            CustomEventImpl.initializeCustomForBinding(
              this as CustomEventImpl,
              type as string,
              Boolean(dictionary.bubbles),
              Boolean(dictionary.cancelable),
              Boolean(dictionary.composed),
              dictionary.detail,
            );
          },
          create: {
            arguments: () => ['', {}, this.#host.eventTimeStamp()],
          },
        },
      },
      { implementation: NodeImpl, name: 'Node' },
      { implementation: CharacterDataImpl, name: 'CharacterData' },
      {
        implementation: DocumentImpl,
        name: 'Document',
        options: {
          construct() {
            // DOM requires a constructed Document to inherit the current
            // global object's associated Document origin. That association
            // belongs to HTML's environment lifecycle, which Browlet does not
            // yet model.
          },
          create: {
            arguments: [this],
            created: (value) => {
              this.associateEventTarget(value as EventTargetImpl);
            },
          },
        },
      },
      { implementation: ElementImpl, name: 'Element' },
      { implementation: HTMLElementImpl, name: 'HTMLElement' },
      { implementation: HTMLHeadElementImpl, name: 'HTMLHeadElement' },
      { implementation: HTMLLinkElementImpl, name: 'HTMLLinkElement' },
      { implementation: HTMLStyleElementImpl, name: 'HTMLStyleElement' },
      { implementation: SVGElementImpl, name: 'SVGElement' },
      { implementation: SVGStyleElementImpl, name: 'SVGStyleElement' },
      { implementation: MathMLElementImpl, name: 'MathMLElement' },
      {
        implementation: TextImpl,
        name: 'Text',
        options: {
          construct(data) { (this as TextImpl).data = data as string; },
          create: {
            arguments: [''],
            created: (value) => {
              this.associateEventTarget(value as TextImpl);
            },
          },
        },
      },
      {
        implementation: CommentImpl,
        name: 'Comment',
        options: {
          construct(data) { (this as CommentImpl).data = data as string; },
          create: {
            arguments: [''],
            created: (value) => {
              this.associateEventTarget(value as CommentImpl);
            },
          },
        },
      },
      { implementation: DocumentTypeImpl, name: 'DocumentType' },
    ];

    for (const { implementation, name, options } of registrations) {
      const interface_ = this.#requireInterface(name);
      this.#implementations.set(implementation, interface_);
      registerInterfaceImplementation(
        registry,
        interface_,
        implementation,
        {
          ...options,
          normalizeException: (exception) =>
            this.#normalizeException(exception),
        },
      );
    }
  }
}

type DOMEventRealmHost = {
  readonly exposure: string;
  readonly global: object;
  eventTimeStamp(): DOMHighResTimeStamp;
  isWindow(global: object): boolean;
  getCurrentEvent(global: object): Event | undefined;
  setCurrentEvent(global: object, event: Event | undefined): void;
  recordTimingInfo(
    global: object,
    event: Event,
    callback: EventListenerOrEventListenerObject,
  ): void;
};

type DOMImplementationRegistration = {
  implementation: ImplementationConstructor<object>;
  name: string;
  options?: InterfaceImplementationOptions;
};

function toImplementationValue(value: unknown): unknown {
  if (!(value instanceof Map)) return value;

  const object: Record<PropertyKey, unknown> = {};
  const dictionary = value as Map<PropertyKey, unknown>;
  for (const [name, memberValue] of dictionary) {
    object[name] = toImplementationValue(memberValue);
  }
  return object;
}

function asDictionary(value: unknown): Record<PropertyKey, unknown> {
  return toImplementationValue(value) as Record<PropertyKey, unknown>;
}

function isDOMEventRealmHost(value: object): value is DOMEventRealmHost {
  return 'eventTimeStamp' in value &&
    'getCurrentEvent' in value &&
    'isWindow' in value;
}

function requireEventListenerValue(
  value: unknown,
): CallbackInterfaceValue {
  if (isCallbackInterfaceValue(value)) return value;
  throw new TypeError('EventListener is not a Web IDL callback value');
}
