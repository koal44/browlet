// These facades add unfinished Web IDL surfaces to the type system only.
// Unimplemented members remain absent at runtime.
type AbstractConstructor<T = object> = abstract new (
  ...args: never[]
) => T;

function extend<TInterface>() {
  return <TBase extends AbstractConstructor>(base: TBase) =>
    base as unknown as ExtendedConstructor<TBase, TInterface>;
}

type ExtendedConstructor<
  TBase extends AbstractConstructor,
  TInterface,
> = TBase extends abstract new (...args: infer TArgs) => infer TInstance
  ? abstract new (...args: TArgs) => TInstance & TInterface
  : never;

export const withCSSStyleDeclaration = extend<CSSStyleDeclaration>();
