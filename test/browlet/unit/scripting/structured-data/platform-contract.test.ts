import { describe, expect, it } from 'vitest';

import { Realm } from '../../../../../src/browlet/scripting/realm';
import {
  createStructuredDataRecord,
} from '../../../../../src/browlet/scripting/structured-data/records';
import {
  serializable, type DeserializationContext, type SerializationContext,
  type SerializableSteps,
} from '../../../../../src/browlet/scripting/structured-data/serializable';
import {
  domExceptionCapabilities,
} from '../../../../../src/browlet/scripting/structured-data/platform-objects/dom-exception';
import {
  isTransferableDetached, markTransferableDetached, transferable,
} from '../../../../../src/browlet/scripting/structured-data/transferable';
import {
  createBindings, defineInterface, xattr,
} from '../../../../../src/web-idl/index';

describe('HTML structured-data platform contracts', () => {
  it('runs DOMException steps across realms through exact interface metadata', () => {
    const domain = createBindings([], {
      capabilities: domExceptionCapabilities,
    });
    const firstRealm = new Realm();
    const secondRealm = new Realm();
    const first = domain.register(firstRealm);
    const second = domain.register(secondRealm);
    first.install(firstRealm.global);
    second.install(secondRealm.global);
    const FirstDOMException = Reflect.get(
      firstRealm.global,
      'DOMException',
    ) as typeof DOMException;
    const SecondDOMException = Reflect.get(
      secondRealm.global,
      'DOMException',
    ) as typeof DOMException;
    const source = new FirstDOMException('some message', 'IndexSizeError');
    Reflect.set(source, 'custom', 'not serialized');
    const sourceBinding = first.context.resolvePlatformObject(source);
    if (!sourceBinding) throw new Error('DOMException was not projected');
    const steps = first.context.getCapability(
      sourceBinding.primaryInterface.definition,
      serializable,
    );
    if (!steps) throw new Error('DOMException is not registered as serializable');
    const serialized = createStructuredDataRecord();

    steps.serializationSteps(
      sourceBinding.implementation,
      serialized,
      false,
      unusedSerializationContext,
    );
    const targetBinding = second.context.createPlatformObject(
      sourceBinding.primaryInterface.definition,
    );
    steps.deserializationSteps(
      serialized,
      targetBinding.implementation,
      secondRealm,
      unusedDeserializationContext,
    );
    const clone = targetBinding.platformObject as DOMException;

    expect(clone).toBeInstanceOf(SecondDOMException);
    expect(clone).not.toBeInstanceOf(FirstDOMException);
    expect(clone.name).toBe('IndexSizeError');
    expect(clone.message).toBe('some message');
    expect(clone.code).toBe(SecondDOMException.INDEX_SIZE_ERR);
    expect(serialized.has('Stack')).toBe(false);
    expect(Reflect.get(clone, 'custom')).toBeUndefined();
  });

  it('gives derived serializable interfaces standalone inherited-state steps', () => {
    const domain = createBindings([], {
      capabilities: domExceptionCapabilities,
    });
    const realm = new Realm();
    const registration = domain.register(realm);
    registration.install(realm.global);
    const QuotaExceededError = Reflect.get(
      realm.global,
      'QuotaExceededError',
    ) as QuotaExceededErrorConstructor;
    const source = new QuotaExceededError('too large', {
      quota: 12,
      requested: 20,
    });
    const sourceBinding = registration.context.resolvePlatformObject(source);
    if (!sourceBinding) throw new Error('QuotaExceededError was not projected');
    const steps = registration.context.getCapability(
      sourceBinding.primaryInterface.definition,
      serializable,
    );
    if (!steps) {
      throw new Error('QuotaExceededError is not registered as serializable');
    }
    const serialized = createStructuredDataRecord();

    steps.serializationSteps(
      sourceBinding.implementation,
      serialized,
      true,
      unusedSerializationContext,
    );
    const targetBinding = registration.context.createPlatformObject(
      sourceBinding.primaryInterface.definition,
    );
    steps.deserializationSteps(
      serialized,
      targetBinding.implementation,
      realm,
      unusedDeserializationContext,
    );
    const clone = targetBinding.platformObject as QuotaExceededError;

    expect(clone).toBeInstanceOf(QuotaExceededError);
    expect(clone.name).toBe('QuotaExceededError');
    expect(clone.message).toBe('too large');
    expect(clone.quota).toBe(12);
    expect(clone.requested).toBe(20);
  });

  it('requires exact no-argument declaration markers', () => {
    const steps: SerializableSteps = {
      deserializationSteps() {},
      serializationSteps() {},
    };
    const missing = defineInterface({
      name: 'MissingSerializableMarker',
      members: [],
    });
    const malformed = defineInterface({
      name: 'MalformedSerializableMarker',
      ...xattr({ arguments: [], kind: 'arguments', name: 'Serializable' }),
      members: [],
    });
    const duplicate = defineInterface({
      name: 'DuplicateSerializableMarker',
      ...xattr('Serializable', 'Serializable'),
      members: [],
    });
    const transferableIDL = defineInterface({
      name: 'TransferableExample',
      ...xattr('Transferable'),
      members: [],
    });
    const malformedTransferable = defineInterface({
      name: 'MalformedTransferableMarker',
      ...xattr({ arguments: [], kind: 'arguments', name: 'Transferable' }),
      members: [],
    });
    const transferSteps = {
      transferReceivingSteps() {},
      transferSteps() {},
    };

    expect(() => serializable.for(missing, steps)).toThrow(
      'must declare exactly one [Serializable] marker',
    );
    expect(() => serializable.for(malformed, steps)).toThrow(
      'must declare exactly one [Serializable] marker',
    );
    expect(() => serializable.for(duplicate, steps)).toThrow(
      'must declare exactly one [Serializable] marker',
    );
    expect(() => transferable.for(missing, transferSteps)).toThrow(
      'must declare exactly one [Transferable] marker',
    );
    expect(() => transferable.for(malformedTransferable, transferSteps)).toThrow(
      'must declare exactly one [Transferable] marker',
    );
    expect(() => transferable.for(transferableIDL, transferSteps))
      .not.toThrow();
  });

  it('tracks transferable platform-object detached state independently', () => {
    const first = {};
    const second = {};

    expect(isTransferableDetached(first)).toBe(false);
    markTransferableDetached(first);
    expect(isTransferableDetached(first)).toBe(true);
    expect(isTransferableDetached(second)).toBe(false);
  });
});

const unusedSerializationContext: SerializationContext = {
  subserialize() {
    throw new Error('DOMException steps do not subserialize');
  },
};

const unusedDeserializationContext: DeserializationContext = {
  subdeserialize() {
    throw new Error('DOMException steps do not subdeserialize');
  },
};

type QuotaExceededError = DOMException & {
  readonly quota: number | null;
  readonly requested: number | null;
};

type QuotaExceededErrorConstructor = {
  new(message?: string, options?: {
    quota?: number;
    requested?: number;
  }): QuotaExceededError;
};
