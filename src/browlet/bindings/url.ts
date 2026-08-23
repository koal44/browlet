import type { AssembledInterface } from '../../web-idl/assembly';
import type { JavaScriptBinding } from '../../web-idl/binding';
import { registerInterfaceImplementation } from '../../web-idl/implementation';
import { missingArgument } from '../../web-idl/overload';
import {
  parseAPIURL, URLImpl, URLSearchParamsImpl,
} from '../../url/api';

export class URLBinding {
  readonly #binding: JavaScriptBinding;
  readonly #url: AssembledInterface;
  readonly #urlSearchParams: AssembledInterface;

  constructor(binding: JavaScriptBinding) {
    this.#binding = binding;
    this.#url = requireInterface(binding, 'URL');
    this.#urlSearchParams = requireInterface(binding, 'URLSearchParams');
    const implementations = binding.implementations;
    const projectSearchParams = (value: URLSearchParamsImpl) => {
      this.#projectSearchParams(value);
    };

    registerInterfaceImplementation(
      implementations,
      this.#url,
      URLImpl,
      {
        construct(input, base) {
          URLImpl.initializeForBinding(
            this as URLImpl,
            input as string,
            base === missingArgument ? undefined : base as string,
          );
          projectSearchParams(URLImpl.getQueryObject(this as URLImpl));
        },
        create(newTarget) {
          if (!newTarget) throw new Error('URL construction requires newTarget');
          return URLImpl.createForBinding(newTarget);
        },
        operations: {
          static: {
            parse: (input, base) => {
              const record = parseAPIURL(
                input as string,
                base === missingArgument ? undefined : base as string,
              );
              if (record === null) return null;

              const object = this.#binding.createPlatformObject(this.#url);
              const implementation = this.#binding.platformObjects
                .getImplementationObject(object) as URLImpl | undefined;
              if (!implementation) {
                throw new Error('URL object has no implementation');
              }
              URLImpl.initializeRecordForBinding(implementation, record);
              projectSearchParams(URLImpl.getQueryObject(implementation));
              return implementation;
            },
          },
        },
      },
    );
    registerInterfaceImplementation(
      implementations,
      this.#urlSearchParams,
      URLSearchParamsImpl,
      {
        construct(init) {
          URLSearchParamsImpl.initializeForBinding(
            this as URLSearchParamsImpl,
            init as Parameters<typeof URLSearchParamsImpl.initializeForBinding>[1],
          );
        },
        create: {},
        stringify() {
          return URLSearchParamsImpl.stringify(this as URLSearchParamsImpl);
        },
        valuePairs() {
          return URLSearchParamsImpl.valuePairs(
            this as URLSearchParamsImpl,
          ).map(([key, value]) => ({ key, value }));
        },
      },
    );
  }

  // -- Private ----------------------------------------------------------

  #projectSearchParams(value: URLSearchParamsImpl): void {
    if (this.#binding.getPlatformObjectRecord(value)) return;
    const prototype = this.#binding.getInterfacePrototypeObject(
      this.#urlSearchParams,
    );
    if (!Reflect.setPrototypeOf(value, prototype)) {
      throw new Error('Could not project URLSearchParams prototype');
    }
    this.#binding.projectPlatformObject(value, this.#urlSearchParams);
  }
}

function requireInterface(
  binding: JavaScriptBinding,
  name: string,
): AssembledInterface {
  const interface_ = binding.definitions.getInterface(name);
  if (!interface_) throw new Error(`Missing URL interface ${name}`);
  return interface_;
}
