import {
  CustomEventImpl, customEventIDL, eventIDL, EventImpl, toDOMString,
} from '../events/event';
import {
  eventTargetIDL, EventTargetImpl, type EventImplementationConstructor,
  type EventListenerInvocationHost,
} from '../events/event-target';
import { cssomDocumentOrShadowRootIDL } from '../css-engine';
import {
  characterDataIDL, CharacterDataImpl,
} from '../nodes/character-data';
import { CommentImpl, commentIDL } from '../nodes/comment';
import {
  DocumentImpl, documentIDL, htmlDocumentIDL,
} from '../nodes/document';
import { DocumentTypeImpl, documentTypeIDL } from '../nodes/document-type';
import {
  ElementImpl, elementIDL, HTMLElementImpl, htmlElementIDL,
  HTMLHeadElementImpl, htmlHeadElementIDL,
  HTMLLinkElementImpl, htmlLinkElementIDL,
  HTMLStyleElementImpl, htmlStyleElementIDL,
  MathMLElementImpl, mathMLElementIDL,
  SVGElementImpl, svgElementIDL,
  SVGStyleElementImpl, svgStyleElementIDL,
} from '../nodes/element';
import type { DOMNodeFactory } from '../nodes/factory';
import { NodeImpl, nodeIDL } from '../nodes/node';
import { TextImpl, textIDL } from '../nodes/text';
import { TreeNode } from '../tree/tree-node';
import {
  bindInterface, type InterfaceBinding, type InterfaceConstruction,
  type InterfaceConstructor, type InterfaceDefinition,
  type ImplementationConstructor,
} from '../../web-idl/binding';

export class DOMBindings
implements DOMNodeFactory, EventListenerInvocationHost
{
  readonly CharacterData: typeof globalThis.CharacterData;
  readonly Comment: typeof globalThis.Comment;
  readonly CustomEvent: typeof globalThis.CustomEvent;
  readonly Document: typeof globalThis.Document;
  readonly DocumentType: typeof globalThis.DocumentType;
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
  readonly #exposed = new Map<string, InterfaceConstructor>();
  readonly #implementations = new Map<
    ImplementationConstructor<object>,
    InterfaceConstructor
  >();
  readonly #interfaces = new Map<
    InterfaceDefinition,
    InterfaceConstructor
  >();
  readonly #exposure: string;
  readonly #host: DOMRealmHost;

  constructor(host: DOMRealmHost) {
    this.#exposure = host.exposure;
    this.#host = host;

    this.Event = this.bind<typeof globalThis.Event>({
      interface: eventIDL,
      implementation: EventImpl,
      construct: (argumentsList, newTarget) => Reflect.construct(
        EventImpl,
        [argumentsList[0], argumentsList[1], host.eventTimeStamp()],
        newTarget,
      ) as object,
    });
    this.CustomEvent = this.bind<typeof globalThis.CustomEvent>({
      interface: customEventIDL,
      implementation: CustomEventImpl,
      construct: (argumentsList, newTarget) => Reflect.construct(
        CustomEventImpl,
        [argumentsList[0], argumentsList[1], host.eventTimeStamp()],
        newTarget,
      ) as object,
    });
    this.EventTarget = this.bind<typeof globalThis.EventTarget>({
      interface: eventTargetIDL,
      implementation: EventTargetImpl,
      construct: (_argumentsList, newTarget) => Reflect.construct(
        EventTargetImpl,
        [],
        newTarget,
      ) as object,
    });
    this.Node = this.bind<typeof globalThis.Node>({
      interface: nodeIDL,
      implementation: NodeImpl,
      prototypeSources: [NodeImpl.prototype, TreeNode.prototype],
    });
    this.CharacterData = this.bind<typeof globalThis.CharacterData>({
      interface: characterDataIDL,
      implementation: CharacterDataImpl,
      prototypeSources: [
        CharacterDataImpl.prototype,
        NodeImpl.prototype,
        TreeNode.prototype,
      ],
    });
    this.Document = this.bind<typeof globalThis.Document>({
      interface: documentIDL,
      implementation: DocumentImpl,
      prototypeSources: [
        DocumentImpl.prototype,
        NodeImpl.prototype,
        TreeNode.prototype,
      ],
      construct: (_argumentsList, newTarget) => Reflect.construct(
        DocumentImpl,
        [undefined, this],
        newTarget,
      ) as object,
    });
    this.Element = this.bind<typeof globalThis.Element>({
      interface: elementIDL,
      implementation: ElementImpl,
      prototypeSources: [
        ElementImpl.prototype,
        NodeImpl.prototype,
        TreeNode.prototype,
      ],
    });
    this.HTMLElement = this.bind<typeof globalThis.HTMLElement>({
      interface: htmlElementIDL,
      implementation: HTMLElementImpl,
    });
    this.HTMLHeadElement = this.bind<typeof globalThis.HTMLHeadElement>({
      interface: htmlHeadElementIDL,
      implementation: HTMLHeadElementImpl,
    });
    this.HTMLLinkElement = this.bind<typeof globalThis.HTMLLinkElement>({
      interface: htmlLinkElementIDL,
      implementation: HTMLLinkElementImpl,
    });
    this.HTMLStyleElement = this.bind<typeof globalThis.HTMLStyleElement>({
      interface: htmlStyleElementIDL,
      implementation: HTMLStyleElementImpl,
    });
    this.SVGElement = this.bind<typeof globalThis.SVGElement>({
      interface: svgElementIDL,
      implementation: SVGElementImpl,
    });
    this.SVGStyleElement = this.bind<typeof globalThis.SVGStyleElement>({
      interface: svgStyleElementIDL,
      implementation: SVGStyleElementImpl,
    });
    this.MathMLElement = this.bind<typeof globalThis.MathMLElement>({
      interface: mathMLElementIDL,
      implementation: MathMLElementImpl,
    });
    this.Text = this.bind<typeof globalThis.Text>({
      interface: textIDL,
      implementation: TextImpl,
      prototypeSources: [
        TextImpl.prototype,
        NodeImpl.prototype,
        TreeNode.prototype,
      ],
      construct: constructCharacterData(TextImpl),
    });
    this.Comment = this.bind<typeof globalThis.Comment>({
      interface: commentIDL,
      implementation: CommentImpl,
      prototypeSources: [
        CommentImpl.prototype,
        NodeImpl.prototype,
        TreeNode.prototype,
      ],
      construct: constructCharacterData(CommentImpl),
    });
    this.DocumentType = this.bind<typeof globalThis.DocumentType>({
      interface: documentTypeIDL,
      implementation: DocumentTypeImpl,
      prototypeSources: [DocumentTypeImpl.prototype, TreeNode.prototype],
    });
  }

  get exposed(): ReadonlyMap<string, InterfaceConstructor> {
    return this.#exposed;
  }

  createEvent(
    eventConstructor: EventImplementationConstructor = EventImpl,
  ): EventImpl {
    const event = this.construct(eventConstructor, [
      '',
      {},
      this.#host.eventTimeStamp(),
    ]);
    EventImpl.setTrusted(event, true);
    return event;
  }

  getAssociatedGlobal(
    _callback: EventListenerOrEventListenerObject,
  ): object {
    // TODO(Web IDL callback values): Resolve this from the callback's
    // associated realm when callbacks can cross Domlet realm boundaries.
    return this.#host.global;
  }

  isWindow(global: object): boolean {
    return this.#host.isWindow(global);
  }

  getCurrentEvent(global: object): Event | undefined {
    return this.#host.getCurrentEvent(global);
  }

  setCurrentEvent(global: object, event: Event | undefined): void {
    this.#host.setCurrentEvent(global, event);
  }

  recordTimingInfo(
    global: object,
    event: Event,
    callback: EventListenerOrEventListenerObject,
  ): void {
    this.#host.recordTimingInfo(global, event, callback);
  }

  callUserObjectOperation(
    callback: EventListenerOrEventListenerObject,
    _operation: 'handleEvent',
    [event]: readonly [Event],
    thisArgument: EventTarget,
  ): void {
    if (typeof callback === 'function') {
      callback.call(thisArgument, event);
    } else {
      callback.handleEvent.call(callback, event);
    }
  }

  reportException(exception: unknown, global: object): void {
    this.#host.reportException(exception, global);
  }

  associateEventTarget(target: EventTargetImpl): void {
    EventTargetImpl.associateInvocationHost(target, this);
  }

  construct<T extends object>(
    implementation: ImplementationConstructor<T>,
    argumentsList: readonly unknown[],
  ): T {
    return this.#associate(Reflect.construct(
      implementation,
      argumentsList,
      this.#implementations.get(implementation) ?? implementation,
    ) as T);
  }

  private bind<TConstructor extends InterfaceConstructor>(
    binding: InterfaceBinding,
  ): TConstructor {
    const parent = binding.interface.parent
      ? this.#interfaces.get(binding.interface.parent)
      : undefined;

    if (binding.interface.parent && !parent) {
      throw new Error(
        `Bind ${binding.interface.parent.name} before ${binding.interface.name}`,
      );
    }

    const construction = binding.construct;
    const Interface = bindInterface(
      construction
        ? {
          ...binding,
          construct: (argumentsList, newTarget) => this.#associate(
            construction(argumentsList, newTarget),
          ),
        }
        : binding,
      parent,
      domPartials,
    );
    this.#interfaces.set(binding.interface, Interface);
    this.#implementations.set(binding.implementation, Interface);

    if (
      binding.interface.exposed === '*' ||
      binding.interface.exposed?.includes(this.#exposure)
    ) {
      this.#exposed.set(binding.interface.name, Interface);
    }

    return Interface as TConstructor;
  }

  #associate<T extends object>(value: T): T {
    if (EventTargetImpl.is(value)) this.associateEventTarget(value);
    return value;
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
  reportException(exception: unknown, global: object): void;
};

const domPartials = [htmlDocumentIDL, cssomDocumentOrShadowRootIDL];

function constructCharacterData(
  implementation: ImplementationConstructor<object>,
): InterfaceConstruction {
  return (argumentsList, newTarget) => {
    const data = argumentsList[0] === undefined
      ? ''
      : toDOMString(argumentsList[0]);

    return Reflect.construct(implementation, [data], newTarget) as object;
  };
}
