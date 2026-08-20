import { describe, expect, it } from 'vitest';

import { Realm } from '../../../src/browlet/realm';
import { assembleDefinitions } from '../../../src/web-idl/assembly';
import { JavaScriptBinding } from '../../../src/web-idl/binding';
import {
  defineInterface, idlType, promise as promiseType,
  type AttributeMember, type OperationMember,
} from '../../../src/web-idl/definition';
import { ImplementationRegistry } from '../../../src/web-idl/implementation';
import { PlatformObjectRegistry } from '../../../src/web-idl/platform-object';
import { createResolvedPromise } from '../../../src/web-idl/promise';

describe('Web IDL promise member binding', () => {
  it('projects promise-valued attributes and operations into their realm', async () => {
    const resolvedAttribute = attribute('resolved', promiseType(idlType.long));
    const rejectedAttribute = attribute('rejected', promiseType(idlType.long));
    const resolvedOperation = operation('resolve', promiseType(idlType.long));
    const rejectedOperation = operation('reject', promiseType(idlType.long));
    const interface_ = defineInterface({
      exposed: ['Window'],
      members: [
        resolvedAttribute,
        rejectedAttribute,
        resolvedOperation,
        rejectedOperation,
      ],
      name: 'PromiseOwner',
    });
    const implementations = new ImplementationRegistry();
    const reason = new Error('implementation failed');
    implementations.setAttributeSteps(resolvedAttribute, {
      get: () => createResolvedPromise(4, idlType.long, binding),
    });
    implementations.setAttributeSteps(rejectedAttribute, {
      get() { throw reason; },
    });
    implementations.setOperationSteps(
      resolvedOperation,
      () => createResolvedPromise(5, idlType.long, binding),
    );
    implementations.setOperationSteps(rejectedOperation, () => {
      throw reason;
    });

    const realm = new Realm();
    const binding = new JavaScriptBinding(
      assembleDefinitions([interface_]),
      realm,
      new PlatformObjectRegistry(),
      implementations,
    );
    const object = binding.createPlatformObject('PromiseOwner');
    const resolvedProperty = Reflect.get(object, 'resolved') as Promise<unknown>;
    const rejectedProperty = Reflect.get(object, 'rejected') as Promise<unknown>;
    const resolvedCall = call(object, 'resolve') as Promise<unknown>;
    const rejectedCall = call(object, 'reject') as Promise<unknown>;

    for (const promise of [
      resolvedProperty,
      rejectedProperty,
      resolvedCall,
      rejectedCall,
    ]) {
      expect(promise).toBeInstanceOf(realm.intrinsics.promise.constructor);
      expect(promise).not.toBeInstanceOf(Promise);
    }
    await expect(resolvedProperty).resolves.toBe(4);
    await expect(resolvedCall).resolves.toBe(5);
    await expect(rejectedProperty).rejects.toBe(reason);
    await expect(rejectedCall).rejects.toBe(reason);
  });

  it('turns receiver errors from promise-returning operations into rejections', async () => {
    const read = operation('read', promiseType(idlType.long));
    const interface_ = defineInterface({
      exposed: ['Window'],
      members: [read],
      name: 'PromiseReceiver',
    });
    const realm = new Realm();
    const implementations = new ImplementationRegistry();
    implementations.setOperationSteps(read, () => {
      throw new Error('unreachable');
    });
    const binding = new JavaScriptBinding(
      assembleDefinitions([interface_]),
      realm,
      new PlatformObjectRegistry(),
      implementations,
    );
    const object = binding.createPlatformObject('PromiseReceiver');
    const method = Reflect.get(object, 'read') as CallableFunction;
    const promise = Reflect.apply(method, {}, []) as Promise<unknown>;

    expect(promise).toBeInstanceOf(realm.intrinsics.promise.constructor);
    await expect(promise).rejects.toBeInstanceOf(realm.intrinsics.typeError);
  });
});

function attribute(
  name: string,
  type: AttributeMember['type'],
): AttributeMember {
  return { kind: 'attribute', name, readonly: true, type };
}

function operation(
  name: string,
  returns: OperationMember['returns'],
): OperationMember {
  return { arguments: [], kind: 'operation', name, returns };
}

function call(object: object, name: string): unknown {
  const method = Reflect.get(object, name) as unknown;
  if (typeof method !== 'function') throw new Error(`${name} is not callable`);
  return Reflect.apply(method, object, []);
}
