import type { AssembledInterface } from '../web-idl/assembly';
import type { JavaScriptBinding } from '../web-idl/binding';
import type {
  ConstructorMember, InterfaceDefinition, IterableMember, OperationMember,
  StringifierMember,
} from '../web-idl/definition';
import { registerInterfaceImplementation } from '../web-idl/implementation';
import { missingArgument } from '../web-idl/overload';
import {
  parseAPIURL, URLImpl, URLSearchParamsImpl,
} from '../url/api';
import {
  urlIDL, urlSearchParamsIDL,
} from '../url/web-idl';

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
    );
    registerInterfaceImplementation(
      implementations,
      this.#urlSearchParams,
      URLSearchParamsImpl,
    );

    implementations.setObjectCreationSteps(urlIDL, (newTarget) =>
      URLImpl.createForBinding(requireNewTarget(newTarget)));
    implementations.setConstructorSteps(
      requireConstructor(urlIDL),
      function(input, base) {
        URLImpl.initializeForBinding(
          this as URLImpl,
          input as string,
          base === missingArgument ? undefined : base as string,
        );
        projectSearchParams(URLImpl.getQueryObject(this as URLImpl));
      },
    );

    implementations.setObjectCreationSteps(
      urlSearchParamsIDL,
      (newTarget) => Reflect.construct(
        URLSearchParamsImpl,
        [],
        requireNewTarget(newTarget) as NewTarget,
      ),
    );
    implementations.setConstructorSteps(
      requireConstructor(urlSearchParamsIDL),
      function(init) {
        URLSearchParamsImpl.initializeForBinding(
          this as URLSearchParamsImpl,
          init as Parameters<typeof URLSearchParamsImpl.initializeForBinding>[1],
        );
      },
    );
    implementations.setValuePairsSteps(
      requireMember(urlSearchParamsIDL, 'iterable'),
      function() {
        return URLSearchParamsImpl.valuePairs(this as URLSearchParamsImpl).map(
          ([key, value]) => ({ key, value }),
        );
      },
    );
    implementations.setStringificationBehavior(
      requireMember(urlSearchParamsIDL, 'stringifier'),
      function() {
        return URLSearchParamsImpl.stringify(this as URLSearchParamsImpl);
      },
    );

    const parse = requireOperation(urlIDL, 'parse', true);
    implementations.setOperationSteps(parse, (input, base) => {
      const record = parseAPIURL(
        input as string,
        base === missingArgument ? undefined : base as string,
      );
      if (record === null) return null;

      const object = this.#binding.createPlatformObject(this.#url);
      const implementation = this.#binding.platformObjects
        .getImplementationObject(object) as URLImpl | undefined;
      if (!implementation) throw new Error('URL object has no implementation');
      URLImpl.initializeRecordForBinding(implementation, record);
      projectSearchParams(URLImpl.getQueryObject(implementation));
      return implementation;
    });
  }

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

function requireConstructor(interface_: InterfaceDefinition): ConstructorMember {
  const constructor = interface_.members.find(
    (member): member is ConstructorMember => member.kind === 'constructor',
  );
  if (!constructor) throw new Error(`${interface_.name} has no constructor`);
  return constructor;
}

function requireOperation(
  interface_: InterfaceDefinition,
  name: string,
  static_: boolean,
): OperationMember {
  const operation = interface_.members.find(
    (member): member is OperationMember =>
      member.kind === 'operation' &&
      member.name === name && Boolean(member.static) === static_,
  );
  if (!operation) throw new Error(`${interface_.name} has no ${name} operation`);
  return operation;
}

function requireMember(
  interface_: InterfaceDefinition,
  kind: 'iterable',
): IterableMember;
function requireMember(
  interface_: InterfaceDefinition,
  kind: 'stringifier',
): StringifierMember;
function requireMember(
  interface_: InterfaceDefinition,
  kind: 'iterable' | 'stringifier',
): IterableMember | StringifierMember {
  const member = interface_.members.find((candidate) => candidate.kind === kind);
  if (!member || (member.kind !== 'iterable' && member.kind !== 'stringifier')) {
    throw new Error(`${interface_.name} has no ${kind} declaration`);
  }
  return member;
}

function requireNewTarget(value: object | undefined): object {
  if (!value) throw new Error('URL construction requires newTarget');
  return value;
}

type NewTarget = new (...argumentsList: never[]) => object;
