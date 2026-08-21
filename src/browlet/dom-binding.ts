import type { AssembledInterface } from '../web-idl/assembly';
import {
  callUserObjectOperation as callWebIDLUserObjectOperation,
} from '../web-idl/callback';
import {
  isCallbackInterfaceValue, type CallbackInterfaceValue,
} from '../web-idl/callback-value';
import { convertToIDL } from '../web-idl/conversion';
import type {
  ConstructorMember, InterfaceDefinition,
} from '../web-idl/definition';
import {
  registerDOMExceptionImplementations,
} from '../web-idl/dom-exception';
import type {
  ImplementationConstructor, ImplementationRegistry,
} from '../web-idl/implementation';
import { registerInterfaceImplementation } from '../web-idl/implementation';
import type { JavaScriptBinding } from '../web-idl/binding';
import {
  CustomEventImpl, customEventIDL, eventIDL, EventImpl,
} from '../domlet/events/event';
import {
  eventTargetIDL, EventTargetImpl, type EventImplementationConstructor,
  type EventListenerCallback, type EventListenerInvocationHost,
} from '../domlet/events/event-target';
import { CharacterDataImpl } from '../domlet/nodes/character-data';
import { CommentImpl, commentIDL } from '../domlet/nodes/comment';
import { DocumentImpl, documentIDL } from '../domlet/nodes/document';
import { DocumentTypeImpl } from '../domlet/nodes/document-type';
import {
  ElementImpl, HTMLElementImpl, HTMLHeadElementImpl, HTMLLinkElementImpl,
  HTMLStyleElementImpl, MathMLElementImpl, SVGElementImpl, SVGStyleElementImpl,
} from '../domlet/nodes/element';
import type { DOMNodeFactory } from '../domlet/nodes/factory';
import { NodeImpl } from '../domlet/nodes/node';
import { TextImpl, textIDL } from '../domlet/nodes/text';
import type { Realm } from './realm';

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

    for (const [name, implementation] of domImplementationClasses) {
      const interface_ = this.#requireInterface(name);
      this.#implementations.set(implementation, interface_);
      registerInterfaceImplementation(
        implementations,
        interface_,
        implementation,
        (exception) => this.#normalizeException(exception),
      );
    }
    registerDOMExceptionImplementations(implementations, host);
    this.#registerConstructors(implementations);
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

  #registerConstructors(implementations: ImplementationRegistry): void {
    registerObjectCreation(
      implementations,
      eventTargetIDL,
      EventTargetImpl,
      [],
      (value) => this.associateEventTarget(value as EventTargetImpl),
    );
    implementations.setConstructorSteps(
      requireConstructor(eventTargetIDL),
      () => undefined,
    );

    registerObjectCreation(
      implementations,
      eventIDL,
      EventImpl,
      ['', {}, this.#host.eventTimeStamp()],
    );
    implementations.setConstructorSteps(
      requireConstructor(eventIDL),
      function(type, init) {
        const dictionary = asDictionary(init);
        EventImpl.initializeForBinding(
          this as EventImpl,
          type as string,
          Boolean(dictionary.bubbles),
          Boolean(dictionary.cancelable),
          Boolean(dictionary.composed),
        );
      },
    );

    registerObjectCreation(
      implementations,
      customEventIDL,
      CustomEventImpl,
      ['', {}, this.#host.eventTimeStamp()],
    );
    implementations.setConstructorSteps(
      requireConstructor(customEventIDL),
      function(type, init) {
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
    );

    registerObjectCreation(
      implementations,
      documentIDL,
      DocumentImpl,
      [undefined, this],
      (value) => this.associateEventTarget(value as EventTargetImpl),
    );
    implementations.setConstructorSteps(
      requireConstructor(documentIDL),
      () => undefined,
    );

    registerCharacterDataConstructor(
      implementations,
      textIDL,
      TextImpl,
      (value) => this.associateEventTarget(value),
    );
    registerCharacterDataConstructor(
      implementations,
      commentIDL,
      CommentImpl,
      (value) => this.associateEventTarget(value),
    );
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

const domImplementationClasses: [
  string,
  ImplementationConstructor<object>,
][] = [
  ['EventTarget', EventTargetImpl],
  ['Event', EventImpl],
  ['CustomEvent', CustomEventImpl],
  ['Node', NodeImpl],
  ['CharacterData', CharacterDataImpl],
  ['Document', DocumentImpl],
  ['Element', ElementImpl],
  ['HTMLElement', HTMLElementImpl],
  ['HTMLHeadElement', HTMLHeadElementImpl],
  ['HTMLLinkElement', HTMLLinkElementImpl],
  ['HTMLStyleElement', HTMLStyleElementImpl],
  ['SVGElement', SVGElementImpl],
  ['SVGStyleElement', SVGStyleElementImpl],
  ['MathMLElement', MathMLElementImpl],
  ['Text', TextImpl],
  ['Comment', CommentImpl],
  ['DocumentType', DocumentTypeImpl],
];

function registerObjectCreation(
  registry: ImplementationRegistry,
  interface_: InterfaceDefinition,
  implementation: ImplementationConstructor<object>,
  argumentsList: readonly unknown[],
  created?: (value: object) => void,
): void {
  registry.setObjectCreationSteps(interface_, (newTarget) => {
    const value = Reflect.construct(
      implementation,
      argumentsList,
      newTarget as unknown as ImplementationConstructor<object>,
    ) as object;
    created?.(value);
    return value;
  });
}

function registerCharacterDataConstructor(
  registry: ImplementationRegistry,
  interface_: InterfaceDefinition,
  implementation: ImplementationConstructor<CharacterDataImpl>,
  created: (value: CharacterDataImpl) => void,
): void {
  registerObjectCreation(
    registry,
    interface_,
    implementation,
    [''],
    (value) => created(value as CharacterDataImpl),
  );
  registry.setConstructorSteps(
    requireConstructor(interface_),
    function(data) {
      (this as CharacterDataImpl).data = data as string;
    },
  );
}

function requireConstructor(
  interface_: InterfaceDefinition,
): ConstructorMember {
  const constructor = interface_.members.find(
    (member): member is ConstructorMember => member.kind === 'constructor',
  );
  if (!constructor) {
    throw new Error(`${interface_.name} has no constructor declaration`);
  }
  return constructor;
}

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
