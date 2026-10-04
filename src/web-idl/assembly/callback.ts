import { InternalError } from '../../infra/index';
import {
  hasExtendedAttribute, type CallbackFunctionDefinition, type CallbackInterfaceDefinition, type Definition,
} from '../core/index';

import type { WebIDLRealm } from '../environment';

import { matchesExposure } from './exposure';
import type { AssemblySteps } from './assembly';
import {
  AssembledCallable, AssembledArgument, assembleMember, type IDLConstant, type IDLOperation,
} from './member';

/** A callback interface used for conversion and invocation. */
export class AssembledCallbackInterface {
  /** Original callback-interface declaration, including any custom implementation adapter. */
  primary: CallbackInterfaceDefinition;
  /** Prepared operations used to convert callback arguments and results. */
  operationsByName = new Map<string, IDLOperation>();

  /** Constants and operations with compiled argument and result types. */
  members: (IDLConstant | IDLOperation)[] = [];

  constructor(primary: CallbackInterfaceDefinition, finish: AssemblySteps[]) {
    this.primary = primary;
    finish.push((assembly) => {
      for (const declaredMember of primary.members) {
        const member = assembleMember(declaredMember, assembly);
        this.members.push(member);
        if (member.kind !== 'operation' || member.name === undefined) continue;
        if (!this.operationsByName.has(member.name)) {
          this.operationsByName.set(member.name, member);
        }
      }
    });
  }

  /** Whether this callback interface's declared exposure requirements match the realm. */
  isExposed(realm: WebIDLRealm): boolean {
    return matchesExposure(this.primary, realm);
  }

  /** For a selected callback interface, whether this compiled member permits exposure. */
  isMemberExposed(member: IDLConstant | IDLOperation, realm: WebIDLRealm): boolean {
    return matchesExposure(member, realm);
  }

  /** Find the declared operation required by callback invocation. */
  getOperation(name: string): IDLOperation {
    const operation = this.operationsByName.get(name);
    if (!operation) {
      throw new InternalError(
        `Callback interface ${this.primary.name} has no ${name} operation`,
      );
    }
    return operation;
  }

  /** Only exposed callback interfaces with constants receive a legacy interface object. */
  hasInterfaceObject(): boolean {
    return this.primary.exposed !== undefined && this.members.some((member) => member.kind === 'constant');
  }
}

/** A callback function's argument and result contract. */
export class AssembledCallbackFunction extends AssembledCallable {
  /** Original callback metadata, without its uncompiled argument and return types. */
  primary: Omit<CallbackFunctionDefinition, 'arguments' | 'returns'>;
  /** Whether nullable attributes accept non-object values as null. */
  treatsNonObjectAsNull: boolean;

  constructor(primary: CallbackFunctionDefinition, finish: AssemblySteps[]) {
    const { arguments: argumentsList, returns, ...metadata } = primary;
    super();
    this.primary = metadata;
    this.treatsNonObjectAsNull = hasExtendedAttribute(primary.extendedAttributes, 'LegacyTreatNonObjectAsNull');
    finish.push((assembly) => {
      this.returns = assembly.getIDLType(returns);
      this.setArguments(argumentsList.map((argument) => new AssembledArgument(argument, assembly)));
    });
  }
}

/** Index callback interfaces by name and identify declarations with legacy interface objects. */
export class AssembledCallbackInterfaces extends Map<string, AssembledCallbackInterface> {
  constructor(definitions: Definition[], finish: AssemblySteps[]) {
    super();
    for (const definition of definitions) {
      if (definition.kind === 'callback-interface') {
        this.set(definition.name, new AssembledCallbackInterface(definition, finish));
      }
    }
  }

  /** Visit declarations eligible for a legacy callback interface object before realm exposure checks. */
  *withInterfaceObjects(): IterableIterator<AssembledCallbackInterface> {
    for (const assembled of this.values()) {
      if (assembled.hasInterfaceObject()) yield assembled;
    }
  }
}

/** Index callback functions by their IDL names. */
export class AssembledCallbackFunctions extends Map<string, AssembledCallbackFunction> {
  constructor(definitions: Definition[], finish: AssemblySteps[]) {
    super();
    for (const definition of definitions) {
      if (definition.kind === 'callback-function') {
        this.set(definition.name, new AssembledCallbackFunction(definition, finish));
      }
    }
  }
}
