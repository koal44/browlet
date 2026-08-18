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
> = TBase extends abstract new (...args: infer TArgs) => infer TInstance
  ? abstract new (...args: TArgs) => TInstance & TInterface
  : never;

export const withNodeStub = stub<Node>();
export const withDocumentTypeStub = stub<DocumentType>();
export const withElementStub = stub<Element>();
export const withHTMLElementStub = stub<HTMLElement>();
export const withHTMLHeadElementStub = stub<HTMLHeadElement>();
export const withHTMLLinkElementStub = stub<HTMLLinkElement>();
export const withHTMLStyleElementStub = stub<HTMLStyleElement>();
export const withSVGElementStub = stub<SVGElement>();
export const withSVGStyleElementStub = stub<SVGStyleElement>();
export const withMathMLElementStub = stub<MathMLElement>();
export const withTextStub = stub<Text>();
export const withCommentStub = stub<Comment>();

export const AttrStub = stub<Attr>()(class {});

export function asDocument<T extends object>(document: T): T & Document {
  return document as T & Document;
}
