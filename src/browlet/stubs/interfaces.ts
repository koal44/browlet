// This facade adds the unfinished Web IDL surface to the type system only.
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
export const withWindowStub = stub<Window>();
