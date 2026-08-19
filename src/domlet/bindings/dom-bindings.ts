import {
  CustomEventImpl, customEventIDL, eventIDL, EventImpl, toDOMString,
} from '../events/event';
import { eventTargetIDL, EventTargetImpl } from '../events/event-target';
import { cssomDocumentOrShadowRootIDL } from '../css-engine';
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

export class DOMBindings implements DOMNodeFactory {
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

  constructor(host: DOMRealmHost) {
    this.#exposure = host.exposure;

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

  construct<T extends object>(
    implementation: ImplementationConstructor<T>,
    argumentsList: readonly unknown[],
  ): T {
    return Reflect.construct(
      implementation,
      argumentsList,
      this.#implementations.get(implementation) ?? implementation,
    ) as T;
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

    const Interface = bindInterface(binding, parent, domPartials);
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
}

export type DOMRealmHost = {
  readonly exposure: string;
  eventTimeStamp(): DOMHighResTimeStamp;
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
