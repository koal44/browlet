import type { AssembledInterface } from '../../web-idl/assembly';
import {
  callUserObjectOperation as callWebIDLUserObjectOperation,
} from '../../web-idl/callback';
import {
  isCallbackInterfaceValue, type CallbackInterfaceValue,
} from '../../web-idl/callback-value';
import { convertToIDL } from '../../web-idl/conversion';
import type {
  AttributeMember, ConstructorMember, InterfaceDefinition, OperationMember,
} from '../../web-idl/definition';
import {
  registerDOMExceptionImplementations,
} from '../../web-idl/dom-exception';
import {
  ImplementationRegistry, type ImplementationConstructor,
} from '../../web-idl/implementation';
import { JavaScriptBinding } from '../../web-idl/binding';
import type { WebIDLRealmHost } from '../../web-idl/javascript-realm';
import { PlatformObjectRegistry } from '../../web-idl/platform-object';
import {
  CustomEventImpl, customEventIDL, eventIDL, EventImpl,
} from '../events/event';
import {
  eventTargetIDL, EventTargetImpl, type EventImplementationConstructor,
  type EventListenerCallback, type EventListenerInvocationHost,
} from '../events/event-target';
import { CharacterDataImpl } from '../nodes/character-data';
import { CommentImpl, commentIDL } from '../nodes/comment';
import { DocumentImpl, documentIDL } from '../nodes/document';
import { DocumentTypeImpl } from '../nodes/document-type';
import {
  ElementImpl, HTMLElementImpl, HTMLHeadElementImpl, HTMLLinkElementImpl,
  HTMLStyleElementImpl, MathMLElementImpl, SVGElementImpl, SVGStyleElementImpl,
} from '../nodes/element';
import type { DOMNodeFactory } from '../nodes/factory';
import { NodeImpl } from '../nodes/node';
import { TextImpl, textIDL } from '../nodes/text';
import { domDefinitions } from './dom-definitions';

export class DOMBindings
implements DOMNodeFactory, EventListenerInvocationHost
{
  readonly CharacterData: typeof globalThis.CharacterData;
  readonly Comment: typeof globalThis.Comment;
  readonly CustomEvent: typeof globalThis.CustomEvent;
  readonly Document: typeof globalThis.Document;
  readonly DocumentType: typeof globalThis.DocumentType;
  readonly DOMException: typeof globalThis.DOMException;
  readonly Element: typeof globalThis.Element;
  readonly Event: typeof globalThis.Event;
  readonly EventTarget: typeof globalThis.EventTarget;
  readonly HTMLElement: typeof globalThis.HTMLElement;
  readonly HTMLHeadElement: typeof globalThis.HTMLHeadElement;
  readonly HTMLLinkElement: typeof globalThis.HTMLLinkElement;
  readonly HTMLStyleElement: typeof globalThis.HTMLStyleElement;
  readonly MathMLElement: typeof globalThis.MathMLElement;
  readonly Node: typeof globalThis.Node;
  readonly SVGElement: typeof globalThis.SVGElement;
  readonly SVGStyleElement: typeof globalThis.SVGStyleElement;
  readonly Text: typeof globalThis.Text;
  readonly #binding: JavaScriptBinding;
  readonly #exposed: ReadonlyMap<string, object>;
  readonly #host: DOMRealmHost;
  readonly #implementations = new Map<
    ImplementationConstructor<object>,
    AssembledInterface
  >();

  constructor(host: DOMRealmHost) {
    this.#host = host;
    const realm = getWebIDLRealmHost(host);
    const implementations = new ImplementationRegistry();

    for (const [name, implementation] of domImplementationClasses) {
      const interface_ = requireInterface(name);
      this.#implementations.set(implementation, interface_);
      registerInterfaceMembers(
        implementations,
        interface_,
        implementation,
        (exception) => this.#normalizeException(exception),
      );
    }
    registerDOMExceptionImplementations(implementations, realm);

    this.#binding = new JavaScriptBinding(
      domDefinitions,
      realm,
      domPlatformObjects,
      implementations,
    );
    this.#registerConstructors(implementations);

    this.Event = this.#getInterface<typeof globalThis.Event>('Event');
    this.CustomEvent = this.#getInterface<typeof globalThis.CustomEvent>(
      'CustomEvent',
    );
    this.EventTarget = this.#getInterface<typeof globalThis.EventTarget>(
      'EventTarget',
    );
    this.Node = this.#getInterface<typeof globalThis.Node>('Node');
    this.CharacterData = this.#getInterface<typeof globalThis.CharacterData>(
      'CharacterData',
    );
    this.Document = this.#getInterface<typeof globalThis.Document>('Document');
    this.Element = this.#getInterface<typeof globalThis.Element>('Element');
    this.HTMLElement = this.#getInterface<typeof globalThis.HTMLElement>(
      'HTMLElement',
    );
    this.HTMLHeadElement = this.#getInterface<
      typeof globalThis.HTMLHeadElement
    >('HTMLHeadElement');
    this.HTMLLinkElement = this.#getInterface<
      typeof globalThis.HTMLLinkElement
    >('HTMLLinkElement');
    this.HTMLStyleElement = this.#getInterface<
      typeof globalThis.HTMLStyleElement
    >('HTMLStyleElement');
    this.SVGElement = this.#getInterface<typeof globalThis.SVGElement>(
      'SVGElement',
    );
    this.SVGStyleElement = this.#getInterface<
      typeof globalThis.SVGStyleElement
    >('SVGStyleElement');
    this.MathMLElement = this.#getInterface<typeof globalThis.MathMLElement>(
      'MathMLElement',
    );
    this.Text = this.#getInterface<typeof globalThis.Text>('Text');
    this.Comment = this.#getInterface<typeof globalThis.Comment>('Comment');
    this.DocumentType = this.#getInterface<typeof globalThis.DocumentType>(
      'DocumentType',
    );
    this.DOMException = this.#getInterface<typeof globalThis.DOMException>(
      'DOMException',
    );

    this.#exposed = this.#binding.getExposedInitialObjects();
  }

  get exposed(): ReadonlyMap<string, object> {
    return this.#exposed;
  }

  createEvent(
    eventConstructor: EventImplementationConstructor = EventImpl,
  ): EventImpl {
    const event = this.#construct(
      eventConstructor,
      ['', {}, this.#host.eventTimeStamp()],
      requireInterface('Event'),
    );
    EventImpl.setTrusted(event, true);
    return event;
  }

  createDOMException(message = '', name = 'Error'): DOMException {
    return new this.DOMException(message, name);
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

  #getCallbackHost(callback: EventListenerCallback): DOMRealmHost {
    const realm = requireEventListenerValue(callback).realm;
    return isDOMRealmHost(realm) ? realm : this.#host;
  }

  #normalizeException(exception: unknown): unknown {
    const interface_ = requireInterface('DOMException');
    if (this.#binding.implements(exception, interface_)) return exception;
    return exception instanceof DOMException
      ? this.createDOMException(exception.message, exception.name)
      : exception;
  }

  #getInterface<TConstructor extends InterfaceConstructor>(
    name: string,
  ): TConstructor {
    return this.#binding.getInterfaceObject(name) as unknown as TConstructor;
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

export type DOMRealmHost = {
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

type InterfaceConstructor = object & { readonly prototype: object; };

const domPlatformObjects = new PlatformObjectRegistry();

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

type ExceptionNormalizer = (exception: unknown) => unknown;

function registerInterfaceMembers(
  registry: ImplementationRegistry,
  interface_: AssembledInterface,
  implementation: ImplementationConstructor<object>,
  normalizeException: ExceptionNormalizer,
): void {
  for (const { member } of interface_.members) {
    if (member.kind === 'attribute') {
      registerAttribute(
        registry,
        member,
        implementation.prototype,
        normalizeException,
      );
    } else if (member.kind === 'operation') {
      registerOperation(
        registry,
        member,
        implementation.prototype,
        normalizeException,
      );
    }
  }
}

function registerAttribute(
  registry: ImplementationRegistry,
  member: AttributeMember,
  prototype: object,
  normalizeException: ExceptionNormalizer,
): void {
  const descriptor = findDescriptor(prototype, member.name);
  if (!descriptor?.get) {
    throw new TypeError(`Web IDL attribute ${member.name} has no implementation`);
  }

  const getterValue: unknown = Reflect.get(descriptor, 'get');
  const setterValue: unknown = Reflect.get(descriptor, 'set');
  const get = getterValue as (this: object) => unknown;
  const set = setterValue as
    ((this: object, value: unknown) => void) | undefined;
  registry.setAttributeSteps(member, {
    get() {
      return callImplementation(get, this, [], normalizeException);
    },
    ...(set && !member.readonly
      ? {
        set(value: unknown) {
          callImplementation(
            set,
            this,
            [toImplementationValue(value)],
            normalizeException,
          );
        },
      }
      : {}),
  });
}

function registerOperation(
  registry: ImplementationRegistry,
  member: OperationMember,
  prototype: object,
  normalizeException: ExceptionNormalizer,
): void {
  const value: unknown = findDescriptor(prototype, member.name ?? '')?.value;
  if (typeof value !== 'function') {
    throw new TypeError(
      `Web IDL operation ${member.name ?? ''} has no implementation`,
    );
  }
  const method = value as (this: object, ...values: unknown[]) => unknown;

  registry.setOperationSteps(member, function(...values) {
    return callImplementation(
      method,
      this,
      values.map(toImplementationValue),
      normalizeException,
    );
  });
}

function callImplementation(
  implementation: (this: object, ...values: unknown[]) => unknown,
  thisArgument: object | null,
  values: unknown[],
  normalizeException: ExceptionNormalizer,
): unknown {
  try {
    return Reflect.apply(implementation, thisArgument, values);
  } catch (exception) {
    throw normalizeException(exception);
  }
}

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

function requireInterface(name: string): AssembledInterface {
  const interface_ = domDefinitions.getInterface(name);
  if (!interface_) throw new Error(`Missing DOM interface ${name}`);
  return interface_;
}

function findDescriptor(
  prototype: object,
  property: PropertyKey,
): PropertyDescriptor | undefined {
  for (
    let current: object | null = prototype;
    current && current !== Object.prototype;
    current = Reflect.getPrototypeOf(current)
  ) {
    const descriptor = Reflect.getOwnPropertyDescriptor(current, property);
    if (descriptor) return descriptor;
  }
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

function getWebIDLRealmHost(host: DOMRealmHost): WebIDLRealmHost {
  return isWebIDLRealmHost(host) ? host : createAmbientWebIDLRealmHost(host);
}

function isWebIDLRealmHost(
  host: DOMRealmHost,
): host is DOMRealmHost & WebIDLRealmHost {
  return 'callbacks' in host &&
    'intrinsics' in host &&
    'createFunction' in host;
}

function isDOMRealmHost(value: object): value is DOMRealmHost {
  return 'eventTimeStamp' in value &&
    'getCurrentEvent' in value &&
    'isWindow' in value;
}

function createAmbientWebIDLRealmHost(host: DOMRealmHost): WebIDLRealmHost {
  const arrayValues = Reflect.get(
    Array.prototype,
    'values',
  ) as WebIDLRealmHost['intrinsics']['iteration']['arrayValues'];
  const arrayIterator = Reflect.apply(arrayValues, [], []) as object;
  const arrayIteratorPrototype = Reflect.getPrototypeOf(arrayIterator);
  const iteratorPrototype = arrayIteratorPrototype &&
    Reflect.getPrototypeOf(arrayIteratorPrototype);
  if (!iteratorPrototype) {
    throw new Error('Could not obtain the ambient Iterator prototype');
  }
  const asyncIterator = (async function* () {})();
  const asyncGeneratorFunctionPrototype = Reflect.getPrototypeOf(
    asyncIterator,
  );
  const asyncGeneratorPrototype = asyncGeneratorFunctionPrototype &&
    Reflect.getPrototypeOf(asyncGeneratorFunctionPrototype);
  const asyncIteratorPrototype = asyncGeneratorPrototype &&
    Reflect.getPrototypeOf(asyncGeneratorPrototype);
  if (!asyncIteratorPrototype) {
    throw new Error('Could not obtain the ambient AsyncIterator prototype');
  }
  const mapIteratorPrototype = Reflect.getPrototypeOf(
    new Map().entries(),
  );
  const setIteratorPrototype = Reflect.getPrototypeOf(
    new Set().values(),
  );
  if (!mapIteratorPrototype || !setIteratorPrototype) {
    throw new Error('Could not obtain the ambient collection iterator prototypes');
  }

  const realm: WebIDLRealmHost = {
    callbacks: {
      captureContext: () => realm,
      cleanUpAfterRunningCallback: () => {},
      cleanUpAfterRunningScript: () => {},
      getAssociatedRealm: () => realm,
      prepareToRunCallback: () => {},
      prepareToRunScript: () => {},
      reportException: (exception) => console.error(exception),
    },
    crossOriginIsolated: false,
    exposure: host.exposure,
    global: host.global,
    isGlobalPrototypeChainMutable: false,
    intrinsics: {
      array: Array,
      bigInt: BigInt,
      bufferSource: {
        arrayBuffer: ArrayBuffer,
        arrayBufferTransfer: Reflect.get(
          ArrayBuffer.prototype,
          'transfer',
        ) as WebIDLRealmHost['intrinsics']['bufferSource']['arrayBufferTransfer'],
        sharedArrayBuffer: typeof SharedArrayBuffer === 'undefined'
          ? undefined
          : SharedArrayBuffer,
        views: {
          BigInt64Array,
          BigUint64Array,
          DataView,
          Float32Array,
          Float64Array,
          Int16Array,
          Int32Array,
          Int8Array,
          Uint16Array,
          Uint32Array,
          Uint8Array,
          Uint8ClampedArray,
        },
      },
      error: Error,
      errorPrototype: Error.prototype,
      function: Function,
      functionPrototype: Function.prototype,
      iteration: {
        arrayEntries: Reflect.get(
          Array.prototype,
          'entries',
        ) as WebIDLRealmHost['intrinsics']['iteration']['arrayEntries'],
        arrayForEach: Reflect.get(
          Array.prototype,
          'forEach',
        ) as WebIDLRealmHost['intrinsics']['iteration']['arrayForEach'],
        arrayKeys: Reflect.get(
          Array.prototype,
          'keys',
        ),
        arrayValues,
        asyncIteratorPrototype,
        iteratorPrototype,
        mapIteratorPrototype,
        setIteratorPrototype,
      },
      number: Number,
      object: Object,
      objectPrototype: Object.prototype,
      promise: {
        constructor: Promise,
        reject: Reflect.get(Promise, 'reject') as WebIDLRealmHost[
          'intrinsics'
        ]['promise']['reject'],
        then: Reflect.get(Promise.prototype, 'then') as WebIDLRealmHost[
          'intrinsics'
        ]['promise']['then'],
      },
      rangeError: RangeError,
      string: String,
      typeError: TypeError,
    },
    secureContext: false,
    createFunction: (steps, options) => {
      const function_ = options.constructible
        ? function(this: unknown, ...argumentsList: unknown[]) {
          return steps(this, argumentsList, new.target);
        }
        : function(this: unknown, ...argumentsList: unknown[]) {
          return steps(this, argumentsList, undefined);
        };
      Object.defineProperties(function_, {
        length: { configurable: true, value: options.length },
        name: { configurable: true, value: options.name },
      });
      return function_;
    },
    performSecurityCheck: () => {},
    queueMicrotask,
  };
  return realm;
}

function requireEventListenerValue(
  value: unknown,
): CallbackInterfaceValue {
  if (isCallbackInterfaceValue(value)) return value;
  throw new TypeError('EventListener is not a Web IDL callback value');
}
