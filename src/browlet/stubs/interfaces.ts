// These facades add unfinished Web IDL surfaces to the type system only.
// Unimplemented members remain absent at runtime.
type AbstractConstructor<T = object> = abstract new (
  ...args: never[]
) => T;

function stub<TInterface>() {
  return <TBase extends AbstractConstructor>(base: TBase) =>
    base as unknown as StubbedConstructor<TBase, TInterface>;
}

type StubbedConstructor<
  TBase extends AbstractConstructor,
  TInterface,
> =
  TBase extends abstract new (...args: infer TArgs) => infer TInstance
    ? abstract new (...args: TArgs) => TInstance & TInterface
    : never;

export const withLocationStub = stub<Location>();
export const withCustomElementRegistryStub = stub<CustomElementRegistry>();
export const withNodeStub = stub<Node>();
export const withDocumentTypeStub = stub<DocumentType>();
export const withDocumentFragmentStub = stub<DocumentFragment>();
export const withShadowRootStub = stub<ShadowRoot>();
export const withElementStub = stub<Element>();
export const withCharacterDataStub = stub<CharacterData>();
export const withTextStub = stub<Text>();
export const withCommentStub = stub<Comment>();
export const withAttrStub = stub<Attr>();
export const withHTMLElementStub = stub<HTMLElement>();
export const withHTMLHeadElementStub = stub<HTMLHeadElement>();
export const withHTMLLinkElementStub = stub<HTMLLinkElement>();
export const withHTMLStyleElementStub = stub<HTMLStyleElement>();
export const withSVGElementStub = stub<SVGElement>();
export const withSVGStyleElementStub = stub<SVGStyleElement>();
export const withMathMLElementStub = stub<MathMLElement>();
export const withWindowStub = stub<Window>();

// TypeScript's lib.dom.d.ts declares Document.documentElement, head, and body
// as non-null, although DOM and HTML allow each getter to return null.
// DocumentImpl keeps the specification's types, so use this assertion only at
// a boundary whose host contract is lib.dom's Document, never within Browlet's
// DOM implementation. A global interface augmentation cannot correct the
// mismatch because TypeScript requires merged property types to be identical.
export function asDocument<T extends object>(document: T): T & Document {
  return document as T & Document;
}
