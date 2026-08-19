import type { ImplementationConstructor } from '../../web-idl/binding';

export type DOMNodeFactory = {
  construct<T extends object>(
    implementation: ImplementationConstructor<T>,
    argumentsList: readonly unknown[],
  ): T;
};

export const directDOMNodeFactory: DOMNodeFactory = {
  construct: <T extends object>(
    implementation: ImplementationConstructor<T>,
    argumentsList: readonly unknown[],
  ) => Reflect.construct(implementation, argumentsList) as T,
};
