import { InternalError } from '../../../infra/index';
import { isObject, type JSFunction, type RealmFunctionSteps } from '../../../js-engine/index';
import {
  hasExtendedAttribute, type AttributeFunctionSteps, type StringifierMember, type ExtendedAttribute,
} from '../../core/index';

import {
  AssembledInterface, type IDLType, type IDLAttribute, type IDLOperation,
  type AssembledNamespace, type AssembledOverloads,
} from '../../assembly/index';
import { IDLPromise } from '../../values/index';
import { CallbackFunctionConverter, type Converter, type ConversionSteps } from '../../converters/index';
import { compileSteps } from '../../compiler';

import type { PlatformRecord, StampedImplInstance } from '../platform';
import type { AsyncIteratorSteps } from './async-iterable';
import type { ImplementationBinding, BoundConstruct } from './implementation';
import type { ValuePairsSteps } from './iterable';
import type { IndexedPropertySteps, NamedPropertySteps } from './legacy';
import type { ObservableArraySteps } from './observable-array';
import { createOverloadResolver } from './overload';

/** Registered implementation steps and platform functions for one member in one realm. */
export class MemberBinding<Assembled extends BoundConstruct = BoundConstruct> {
  /** Registered steps consume converted values and resolved implementation receivers. */
  declare attributeSteps?: AttributeSteps;
  declare constructorBehavior?: ConstructorBehavior;
  declare operationSteps?: OperationSteps;
  /** Result converter for calls whose receiver belongs to the method's binding. */
  declare convertResult?: ConversionSteps;
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

  /** Prepare live field access with property-access feedback isolated to this interface member. */
  createFieldGetter(attribute: IDLAttribute, target: object): AttributeSteps['get'] {
    const { binding, assembled } = this.#implementationBinding;
    return compileSteps<AttributeSteps['get']>(`${assembled.primary.name}.${attribute.name}:field-get`,
      { name: attribute.name, target, binding, InternalError }, `function getField(receiver) {
        const impl = receiver?.implInst ?? target;
        try {
          if (!(name in impl)) {
            throw new InternalError("Web IDL attribute " + name + " has no implementation");
          }
          return impl[name];
        } catch (exception) {
          throw binding.realizeException(exception);
        }
      }`,
    );
  }

  /** Prepare live field assignment with property-access feedback isolated to this interface member. */
  createFieldSetter(attribute: IDLAttribute): (this: object, value: unknown) => void {
    const { assembled } = this.#implementationBinding;
    return compileSteps(`${assembled.primary.name}.${attribute.name}:field-set`,
      { name: attribute.name, InternalError }, `function setField(value) {
        if (!(name in this)) {
          throw new InternalError("Web IDL attribute " + name + " has no implementation");
        }
        this[name] = value;
      }`,
    );
  }

  /** Retain the function returned by this attribute in its receiver's realm. */
  getAttributeFunction(
    this: MemberBinding<MemberOwner>,
    attribute: IDLAttribute,
    createSteps: () => AttributeFunctionSteps,
  ): JSFunction {
    if (this.#attributeFunction) return this.#attributeFunction;
    const realmBinding = this.#implementationBinding.binding;

    const steps = createSteps();
    return this.#attributeFunction = realmBinding.realm.createFunction((thisArgument, argumentsList) => {
      try {
        return Reflect.apply(steps, thisArgument, argumentsList);
      } catch (exception) {
        throw realmBinding.realizeException(exception);
      }
    }, { length: steps.length, name: attribute.name });
  }

  /** Retain the realm-owned getter function and its prepared conversions. */
  // https://webidl.spec.whatwg.org/#dfn-attribute-getter
  getAttributeGetter(
    this: MemberBinding<MemberOwner>,
    attribute: IDLAttribute,
  ): JSFunction {
    if (this.#getter) return this.#getter;
    const { binding: realmBinding, assembled } = this.#implementationBinding;
    const interfaceAssembled = assembled instanceof AssembledInterface ? assembled : undefined;
    const lenient = hasExtendedAttribute(attribute.extendedAttributes, 'LegacyLenientThis');
    const elementType = realmBinding.assembly.getObservableArrayElementType(attribute.type);
    const defaultConverter = realmBinding.getConverter(attribute.type);
    const convertResult = defaultConverter.getIDLToJSSteps();
    const implementation = interfaceAssembled && attribute.inherit
      ? interfaceAssembled.getInheritedAttribute(attribute)
      : attribute;
    const steps = this.attributeSteps;
    // Select the ordinary getter once; special attributes keep their own dispatch below.
    let getterSteps: RealmFunctionSteps;
    if (
      interfaceAssembled && !attribute.static && !lenient && !elementType &&
      implementation === attribute && attribute.type.kind !== 'promise' && steps
    ) {
      getterSteps = compileSteps<RealmFunctionSteps>(`${assembled.primary.name}.${attribute.name}:get`,
        { realmBinding, assembled: interfaceAssembled, name: attribute.name, type: attribute.type, steps, convertResult },
        `function getAttribute(thisArgument) {
          const receiver = realmBinding.getReceiverRecord(thisArgument, assembled, name, "getter", false);
          const convert = receiver.binding === realmBinding
            ? convertResult
            : receiver.binding.getConverter(type).getIDLToJSSteps();
          return convert(steps.get(receiver));
        }`,
      );
    } else {
      getterSteps = (thisArgument) => {
        let resultConverter: Converter | undefined;
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
          resultConverter = !receiver || receiver.binding === realmBinding
            ? defaultConverter
            : receiver.binding.getConverter(attribute.type);

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
          return resultConverter === defaultConverter ? convertResult(value) : resultConverter.getIDLToJSSteps()(value);
        } catch (exception) {
          return this.#handlePromiseException(
            attribute.type,
            exception,
            resultConverter ?? defaultConverter,
          );
        }
      };
    }
    return this.#getter = realmBinding.realm.createFunction(getterSteps, { length: 0, name: `get ${attribute.name}` });
  }

  /** Retain the realm-owned setter function and its prepared conversions. */
  // https://webidl.spec.whatwg.org/#dfn-attribute-setter
  getAttributeSetter(
    this: MemberBinding<MemberOwner>,
    attribute: IDLAttribute,
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
    const type = attribute.type;
    const enumeration = type.kind === 'enumeration' ? type.assembled : undefined;
    const inputConverter = realmBinding.getConverter(enumeration ? realmBinding.assembly.builtinTypes.DOMString : attribute.type);
    const legacyCallback = attribute.type.kind === 'nullable' ? attribute.type.legacyCallback : null;
    const convertInput = legacyCallback
      ? CallbackFunctionConverter.createAttributeSteps(inputConverter, legacyCallback)
      : inputConverter.getJSToIDLSteps();
    const steps = this.attributeSteps;
    // Select ordinary assignment once, as with ordinary attribute getters.
    if (!replaceable && !putForwards && !lenientSetter && !observableArrayElementType && steps?.set) {
      const setterSteps = compileSteps<RealmFunctionSteps>(`${assembled.primary.name}.${attribute.name}:set`,
        { realmBinding, interfaceAssembled, attribute, lenient, invalidReceiver, convertInput, enumeration, steps },
        `function setAttribute(thisArgument, argumentsList) {
          const receiver = attribute.static ? null : realmBinding.getReceiverRecord(
            thisArgument, interfaceAssembled, attribute.name, 'setter', lenient);
          if (receiver === invalidReceiver) return undefined;
          const value = argumentsList[0];
          // Enum inputs that are already strings need only the membership check.
          const idlValue = enumeration && typeof value === 'string' ? value : convertInput(value);
          if (enumeration && !enumeration.hasValue(idlValue)) return undefined;
          steps.set(receiver, idlValue);
          return undefined;
        }`,
      );
      return this.#setter = realmBinding.realm.createFunction(setterSteps, { length: 1, name: `set ${attribute.name}` });
    }
    const setterSteps = compileSteps<RealmFunctionSteps>(`${assembled.primary.name}.${attribute.name}:set`,
      {
        realmBinding, assembled, interfaceAssembled, attribute, replaceable, putForwards, lenientSetter, lenient,
        observableArrayElementType, enumeration, convertInput, memberBinding: this, invalidReceiver,
        isObject, InternalError, missingImplementation,
      },
      `function setAttribute(thisArgument, argumentsList) {
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
              'Could not replace attribute ' + attribute.name,
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
          const forwarded = jsValue[attribute.name];
          if (!isObject(forwarded)) {
            return realmBinding.throwTypeError(
              attribute.name + ' does not reference an object',
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
        if (enumeration && !enumeration.hasValue(idlValue)) return undefined;
        const steps = memberBinding.attributeSteps;
        if (!steps?.set) {
          throw missingImplementation(
            assembled,
            'attribute setter ' + attribute.name,
          );
        }
        steps.set(receiver, idlValue);
        return undefined;
      }`,
    );
    return this.#setter = realmBinding.realm.createFunction(setterSteps, { length: 1, name: `set ${attribute.name}` });
  }

  /** Retain the realm-owned operation function and its prepared conversions. */
  getOperationFunction(
    this: MemberBinding<MemberOwner>,
    name: string,
    operations: AssembledOverloads<IDLOperation>,
  ): JSFunction {
    if (this.#operation) return this.#operation;
    const { binding: realmBinding, assembled } = this.#implementationBinding;
    const source = operations.callables[0];
    if (!source) throw new InternalError(`Operation group ${name} is empty`);
    const resolve = createOverloadResolver(operations, realmBinding, `${assembled.primary.name}.${name}`);
    const interfaceAssembled = assembled instanceof AssembledInterface ? assembled : undefined;
    const implementationBinding = this.#implementationBinding;
    for (const member of operations.callables) {
      const binding = implementationBinding.getOrCreateMemberBinding(member);
      binding.isDefaultOperation = hasExtendedAttribute(member.extendedAttributes, 'Default');
      binding.convertResult = realmBinding.getConverter(member.returns).getIDLToJSSteps();
    }
    // Failed Promise-returning calls allocate in the invoked method's realm.
    const handleException = (exception: unknown) => this.#handlePromiseException(
      source.returns, exception, realmBinding.getConverter(source.returns),
    );
    const operationSteps = compileSteps<RealmFunctionSteps>(`${assembled.primary.name}.${name}:operation`,
      {
        realmBinding, assembled, source, interfaceAssembled, name, resolve, implementationBinding,
        memberBinding: this, InternalError, missingImplementation, handleException,
      },
      `function invokeOperation(thisArgument, argumentsList) {
        try {
          const receiver = interfaceAssembled && !source.static
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
          const operation = overload.callable;
          const operationBinding = operation === source
            ? memberBinding
            : implementationBinding.getOrCreateMemberBinding(operation);
          const steps = operationBinding.operationSteps;
          if (operationBinding.isDefaultOperation) {
            if (!receiver || !interfaceAssembled) {
              throw new InternalError('Default operation used as a static operation');
            }
            return operationBinding.convertResult(
              realmBinding.getImplementationBinding(interfaceAssembled).runDefaultToJSON(receiver),
            );
          }
          if (!steps) {
            throw missingImplementation(assembled, 'operation ' + name);
          }
          const convertResult = resultBinding === realmBinding
            ? operationBinding.convertResult
            : resultBinding.getConverter(operation.returns).getIDLToJSSteps();
          const result = steps(receiver, overload.values);
          return convertResult(result);
        } catch (exception) {
          return handleException(exception);
        }
      }`,
    );
    return this.#operation = realmBinding.realm.createFunction(operationSteps, { length: operations.minimumArgumentCount, name });
  }

  /** Retain the realm-owned stringifier function and its prepared conversions. */
  getStringifierFunction(
    this: MemberBinding<AssembledInterface>,
    stringifier: StringifierMember | IDLAttribute,
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
        return realmBinding.getConverter(realmBinding.assembly.builtinTypes.DOMString).idlToJS(value);
      },
      { length: 0, name: 'toString' },
    );
  }

  // Extracted from Web IDL §3.7.6 Attributes and §3.7.7 Operations — reject promise results when invocation
  // throws.
  #handlePromiseException(
    type: IDLType,
    exception: unknown,
    converter: Converter,
  ): Promise<unknown> {
    if (type.kind !== 'promise') throw exception;
    return IDLPromise.rejected(exception, type.resultType, converter.realm, converter.binding.realizeException).promise;
  }
}

/** Member adapters receive the instance's binding record, or null for static/namespace members. */
export type AttributeSteps = {
  get(receiver: PlatformRecord | null): unknown;
  set?(receiver: PlatformRecord | null, value: unknown): void;
};

/** Initialize an allocated implementation, consuming the invocation's fresh converted argument list. */
export type ConstructorSteps = (
  receiver: object,
  values: unknown[],
) => void;

/** Construct an implementation, consuming the invocation's fresh converted argument list. */
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

/** Member adapters consume the invocation's fresh converted argument list and may modify it in place. */
export type OperationSteps = (
  receiver: PlatformRecord | null,
  values: unknown[],
) => unknown;

export type MemberOwner = AssembledInterface | AssembledNamespace;

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
