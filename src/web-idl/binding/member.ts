import { isObject, type JSFunction } from '../../js-engine/index';
import { AssembledInterface, type AssembledCallable, type AssembledNamespace, type AssembledOverloads } from '../assembled';
import type { ImplementationBinding, BoundConstruct } from './implementation';
import {
  idlType, type AttributeMember, type OperationMember, type StringifierMember,
  type WebIDLType, type ExtendedAttribute,
} from '../core/types';
import { hasExtendedAttribute } from '../core/helpers';
import type { ConversionContext } from '../conversion-context';
import { idlToJS, type ValueConverter } from '../conversion';
import { createOverloadResolver } from './overload';
import { createLegacyCallbackConverter } from '../constructs/callback';
import { PromiseCarrier } from '../constructs/promise';
import type { PlatformRecord, StampedImplInstance } from './platform-object';
import type { AsyncIteratorSteps } from './async-iterable';
import type { IndexedPropertySteps, NamedPropertySteps } from './legacy-platform-object';
import type { ObservableArraySteps } from './observable-array';
import type { ValuePairsSteps } from './iterable';
import { InternalError } from '../../infra/internal-error';

/** Registered implementation steps and platform functions for one member in one realm. */
export class MemberBinding<Assembled extends BoundConstruct = BoundConstruct> {
  /** Registered steps consume converted values and resolved implementation receivers. */
  declare attributeSteps?: AttributeSteps;
  declare constructorBehavior?: ConstructorBehavior;
  declare operationSteps?: OperationSteps;
  /** Result converter for calls whose receiver belongs to the method's binding. */
  declare convertResult?: ValueConverter;
  declare isDefaultOperation?: boolean;
  declare stringificationBehavior?: StringificationBehavior;
  declare indexedPropertySteps?: IndexedPropertySteps;
  declare namedPropertySteps?: NamedPropertySteps;
  declare observableArraySteps?: ObservableArraySteps;
  declare asyncIteratorSteps?: AsyncIteratorSteps;
  declare valuePairsSteps?: ValuePairsSteps;

  /** Platform functions retain their identities after their first installation. */
  #attributeFunction: JSFunction | undefined;
  #getter: JSFunction | undefined;
  #operation: JSFunction | undefined;
  #setter: JSFunction | undefined;
  #stringifier: JSFunction | undefined;
  /** The including construct supplies assembly information and realm facilities. */
  #implementationBinding: ImplementationBinding<Assembled>;

  constructor(implementationBinding: ImplementationBinding<Assembled>) {
    this.#implementationBinding = implementationBinding;
  }

  /** Retain the function returned by this attribute in its receiver's realm. */
  getAttributeFunction(
    this: MemberBinding<MemberOwner>,
    attribute: AttributeMember,
    createCallback: () => AttributeFunctionCallback,
  ): JSFunction {
    if (this.#attributeFunction) return this.#attributeFunction;
    const realmBinding = this.#implementationBinding.binding;

    const callback = createCallback();
    return this.#attributeFunction = realmBinding.realm.createFunction((thisArgument, argumentsList) => {
      try {
        return Reflect.apply(callback, thisArgument, argumentsList);
      } catch (exception) {
        throw realmBinding.realizeException(exception);
      }
    }, { length: callback.length, name: attribute.name });
  }

  /** Retain the realm-owned getter function and its prepared conversions. */
  // https://webidl.spec.whatwg.org/#dfn-attribute-getter
  getAttributeGetter(
    this: MemberBinding<MemberOwner>,
    attribute: AttributeMember,
  ): JSFunction {
    if (this.#getter) return this.#getter;
    const { binding: realmBinding, assembled } = this.#implementationBinding;
    const interfaceAssembled = assembled instanceof AssembledInterface ? assembled : undefined;
    const lenient = hasExtendedAttribute(attribute.extendedAttributes, 'LegacyLenientThis');
    const elementType = realmBinding.assembly.getObservableArrayElementType(attribute.type);
    const defaultContext = realmBinding.getConversionContext(attribute.type);
    const convertResult = defaultContext.getIDLToJSConverter();
    const implementation = interfaceAssembled && attribute.inherit
      ? interfaceAssembled.getInheritedAttribute(attribute)
      : attribute;
    return this.#getter = realmBinding.realm.createFunction((thisArgument) => {
      let resultContext: ConversionContext | undefined;
      try {
        const receiver = interfaceAssembled && !attribute.static
          ? realmBinding.getReceiverRecord(
            thisArgument,
            interfaceAssembled,
            attribute.name,
            'getter',
            lenient,
          )
          : null;
        if (receiver === invalidReceiver) return undefined;
        resultContext = !receiver || receiver.binding === realmBinding
          ? defaultContext
          : receiver.binding.getConversionContext(attribute.type);

        if (elementType) {
          if (!receiver) {
            throw new InternalError('Observable array attribute was not regular');
          }
          return realmBinding.observableArrays.get(
            receiver,
            attribute,
            elementType,
          );
        }

        const steps = (implementation === attribute
          ? this
          : realmBinding.getMemberBinding(assembled, implementation))?.attributeSteps;
        if (!steps) {
          throw missingImplementation(
            assembled,
            `attribute ${attribute.name}`,
          );
        }
        const value = steps.get(receiver);
        return resultContext === defaultContext ? convertResult(value) : resultContext.getIDLToJSConverter()(value);
      } catch (exception) {
        return this.#handlePromiseException(
          attribute.type,
          exception,
          resultContext ?? defaultContext,
        );
      }
    }, { length: 0, name: `get ${attribute.name}` });
  }

  /** Retain the realm-owned setter function and its prepared conversions. */
  // https://webidl.spec.whatwg.org/#dfn-attribute-setter
  getAttributeSetter(
    this: MemberBinding<MemberOwner>,
    attribute: AttributeMember,
  ): JSFunction | undefined {
    if (this.#setter) return this.#setter;
    const { binding: realmBinding, assembled } = this.#implementationBinding;
    if (assembled.primary.kind === 'namespace') return;
    const interfaceAssembled = assembled instanceof AssembledInterface ? assembled : undefined;
    if (!interfaceAssembled) throw new InternalError('Namespace attribute unexpectedly had a setter');
    const replaceable = hasExtendedAttribute(
      attribute.extendedAttributes,
      'Replaceable',
    );
    const putForwards = getIdentifierAttribute(attribute, 'PutForwards');
    const lenientSetter = hasExtendedAttribute(
      attribute.extendedAttributes,
      'LegacyLenientSetter',
    );
    if (attribute.readonly && !replaceable && !putForwards && !lenientSetter) {
      return;
    }
    const lenient = hasExtendedAttribute(attribute.extendedAttributes, 'LegacyLenientThis');
    const observableArrayElementType = realmBinding.assembly.getObservableArrayElementType(attribute.type);
    const type = realmBinding.assembly.getUnannotatedType(attribute.type);
    const enumeration = type.kind === 'reference' ? realmBinding.assembly.enumerations.get(type.name) : undefined;
    const inputContext = realmBinding.getConversionContext(enumeration ? idlType.DOMString : attribute.type);
    const legacyCallback = inputContext.legacyCallback;
    const convertInput = legacyCallback
      ? createLegacyCallbackConverter(inputContext, legacyCallback)
      : inputContext.getJSToIDLConverter();
    return this.#setter = realmBinding.realm.createFunction((thisArgument, argumentsList) => {
      const value = argumentsList[0];
      const jsValue = realmBinding.resolveThisValue(thisArgument);
      const receiver = attribute.static
        ? null
        : realmBinding.getReceiverRecord(
          jsValue,
          interfaceAssembled,
          attribute.name,
          'setter',
          lenient,
        );
      if (replaceable) {
        if (!isObject(jsValue)) return realmBinding.throwTypeError('Invalid receiver');
        if (!Reflect.defineProperty(jsValue, attribute.name, {
          configurable: true,
          enumerable: true,
          value,
          writable: true,
        })) {
          return realmBinding.throwTypeError(
            `Could not replace attribute ${attribute.name}`,
          );
        }
        return undefined;
      }
      if (receiver === invalidReceiver || lenientSetter) return undefined;

      if (putForwards) {
        if (!receiver) throw new InternalError('PutForwards used on a static attribute');
        if (!isObject(jsValue)) {
          return realmBinding.throwTypeError('Invalid receiver');
        }
        const forwarded = (jsValue as Record<string, unknown>)[attribute.name];
        if (!isObject(forwarded)) {
          return realmBinding.throwTypeError(
            `${attribute.name} does not reference an object`,
          );
        }
        Reflect.set(forwarded, putForwards, value);
        return undefined;
      }

      if (observableArrayElementType) {
        if (!receiver) {
          throw new InternalError('Observable array attribute was not regular');
        }
        realmBinding.observableArrays.replace(
          receiver,
          attribute,
          observableArrayElementType,
          value,
        );
        return undefined;
      }

      const idlValue = convertInput(value);
      // https://webidl.spec.whatwg.org/#dfn-attribute-setter
      if (enumeration && !enumeration.hasValue(idlValue as string)) return undefined;
      const steps = this.attributeSteps;
      if (!steps?.set) {
        throw missingImplementation(
          assembled,
          `attribute setter ${attribute.name}`,
        );
      }
      steps.set(receiver, idlValue);
      return undefined;
    }, { length: 1, name: `set ${attribute.name}` });
  }

  /** Retain the realm-owned operation function and its prepared conversions. */
  getOperationFunction(
    this: MemberBinding<MemberOwner>,
    name: string,
    operations: AssembledOverloads<AssembledCallable<OperationMember>>,
  ): JSFunction {
    if (this.#operation) return this.#operation;
    const { binding: realmBinding, assembled } = this.#implementationBinding;
    const source = operations.callables[0];
    if (!source) throw new InternalError(`Operation group ${name} is empty`);
    const resolve = createOverloadResolver(operations, realmBinding);
    const interfaceAssembled = assembled instanceof AssembledInterface ? assembled : undefined;
    const implementationBinding = this.#implementationBinding;
    for (const { primary } of operations.callables) {
      const binding = implementationBinding.getOrCreateMemberBinding(primary);
      binding.isDefaultOperation = hasExtendedAttribute(primary.extendedAttributes, 'Default');
      binding.convertResult = realmBinding.getConversionContext(primary.returns).getIDLToJSConverter();
    }
    return this.#operation = realmBinding.realm.createFunction((thisArgument, argumentsList) => {
      try {
        const receiver = interfaceAssembled && !source.primary.static
          ? realmBinding.getReceiverRecord(
            thisArgument,
            interfaceAssembled,
            name,
            'method',
            false,
          )
          : null;
        // Default to receiver-realm allocation while Web IDL's broader realm rules are unresolved.
        // https://github.com/whatwg/webidl/issues/135
        const resultBinding = receiver?.binding ?? realmBinding;
        const overload = resolve(argumentsList);
        const operation = overload.callable.primary;
        const operationBinding = operation === source.primary
          ? this
          : implementationBinding.getOrCreateMemberBinding(operation);
        const steps = operationBinding.operationSteps;
        if (operationBinding.isDefaultOperation) {
          if (!receiver || !interfaceAssembled) {
            throw new InternalError('Default operation used as a static operation');
          }
          return operationBinding.convertResult!(
            realmBinding.getImplementationBinding(interfaceAssembled).runDefaultToJSON(receiver),
          );
        }
        if (!steps) {
          throw missingImplementation(assembled, `operation ${name}`);
        }
        const convertResult = resultBinding === realmBinding
          ? operationBinding.convertResult!
          : resultBinding.getConversionContext(operation.returns).getIDLToJSConverter();
        const result = steps(receiver, ...overload.values);
        return convertResult(result);
      } catch (exception) {
        return this.#handlePromiseException(
          source.primary.returns,
          exception,
          // Invocation failure creates a new promise in the method realm;
          // allocation of a successful implementation result is unrelated.
          realmBinding.getConversionContext(source.primary.returns),
        );
      }
    }, { length: operations.minimumArgumentCount, name });
  }

  /** Retain the realm-owned stringifier function and its prepared conversions. */
  getStringifierFunction(
    this: MemberBinding<AssembledInterface>,
    stringifier: StringifierMember | AttributeMember,
  ): JSFunction {
    if (this.#stringifier) return this.#stringifier;
    const { binding: realmBinding, assembled } = this.#implementationBinding;

    return this.#stringifier = realmBinding.realm.createFunction(
      (thisArgument) => {
        if (thisArgument === null || thisArgument === undefined) {
          return realmBinding.throwTypeError(
            'Cannot convert null or undefined to an object',
          );
        }
        const identifier = stringifier.kind === 'attribute'
          ? stringifier.name
          : 'toString';
        const receiver = realmBinding.getReceiverRecord(
          thisArgument,
          assembled,
          identifier,
          'method',
          false,
        );
        const object = receiver.implInst;

        let value: unknown;
        if (stringifier.kind === 'attribute') {
          const implementation = stringifier.inherit
            ? assembled.getInheritedAttribute(stringifier)
            : stringifier;
          const steps = realmBinding.getMemberBinding(assembled, implementation)?.attributeSteps;
          if (!steps) {
            throw missingImplementation(
              assembled,
              `stringifier attribute ${stringifier.name}`,
            );
          }
          value = steps.get(receiver);
        } else {
          const behavior = realmBinding.getMemberBinding(assembled, stringifier)?.stringificationBehavior;
          if (!behavior) {
            throw missingImplementation(assembled, 'stringifier');
          }
          value = Reflect.apply(behavior, object, []);
        }
        return idlToJS(value, realmBinding.getConversionContext(idlType.DOMString));
      },
      { length: 0, name: 'toString' },
    );
  }

  // Extracted from Web IDL §3.7.6 Attributes and §3.7.7 Operations — reject promise results when invocation
  // throws.
  #handlePromiseException(
    type: WebIDLType,
    exception: unknown,
    context: ConversionContext,
  ): Promise<unknown> {
    const promiseType = this.#implementationBinding.binding.assembly.getUnannotatedType(type);
    if (promiseType.kind !== 'promise') throw exception;
    return PromiseCarrier.rejected(exception, promiseType.type, context.realm, context.binding.realizeException).promise;
  }
}

/** Member adapters receive the instance's binding record, or null for static/namespace members. */
export type AttributeSteps = {
  get(receiver: PlatformRecord | null): unknown;
  set?(receiver: PlatformRecord | null, value: unknown): void;
};

export type ConstructorSteps = (
  this: object,
  ...values: unknown[]
) => void;

export type ImplementationConstructorSteps = (
  values: unknown[],
) => object;

export type ConstructorBehavior =
  | {
    kind: 'construct';
    steps: ImplementationConstructorSteps;
  }
  | {
    kind: 'initialize';
    steps: ConstructorSteps;
  };

export type StringificationBehavior = (
  this: StampedImplInstance,
) => unknown;

/** Member adapters receive the recognized record before the converted arguments. */
export type OperationSteps = (
  receiver: PlatformRecord | null,
  ...values: unknown[]
) => unknown;

export type MemberOwner = AssembledInterface | AssembledNamespace;

export type AttributeFunctionCallback = (this: unknown, ...argumentsList: unknown[]) => unknown;

export const invalidReceiver = Symbol('invalid receiver');

// Read an identifier-valued extended attribute.
function getIdentifierAttribute(
  construct: { extendedAttributes?: ExtendedAttribute[]; },
  name: string,
): string | undefined {
  const attribute = construct.extendedAttributes?.find(
    (candidate) =>
      candidate.kind === 'identifier' && candidate.name === name,
  );
  return attribute?.kind === 'identifier' ? attribute.value : undefined;
}

// Describe missing implementation steps in a binding declaration.
function missingImplementation(
  assembled: MemberOwner,
  memberName: string,
): Error {
  return new InternalError(
    `Web IDL ${assembled.primary.name} ${memberName} has no implementation steps`,
  );
}
