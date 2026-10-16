import { createManualRealm } from '../../../support/browlet-agent';
import { describe, expect, it, vi } from 'vitest';
import { structuredSerialize } from '../../../../src/browlet/scripting/structured-data/serialize';
import { structuredSerializeWithTransfer } from '../../../../src/browlet/scripting/structured-data/transfer';
import { SandboxEnvironment, type BrowletEnvironment } from '../../../../src/browlet/environment';
import { createBrowletExecution } from '../../../../src/browlet/bindings';
import {
  DetachedTransferableStamper,
} from '../../../../src/browlet/scripting/structured-data/transferable';
import {
  BindingWorld, defineDictionary, defineInterface, defineInterfaceMixin, definePartialInterface,
  impl, xattr, StructuredData, type Definition, type StampedPlatformObject,
  type SerialSteps, type TransferSteps, type SerializationContext, type DeserializationContext,
} from '../../../../src/web-idl/index';
import { validateDefinitions } from '../../../../src/web-idl/assembly/index';

describe('HTML structured-data platform contracts', () => {
  it('runs DOMException steps across realms through exact interface metadata', () => {
    const domain = new BindingWorld([]);
    const firstRealm = createManualRealm();
    const secondRealm = createManualRealm();
    const first = domain.register(firstRealm, (ctx) => ({ realm: ctx.realm }));
    const second = domain.register(secondRealm, (ctx) => ({ realm: ctx.realm }));
    first.install(firstRealm.globalObject);
    second.install(secondRealm.globalObject);
    const FirstDOMException = Reflect.get(
      firstRealm.globalObject,
      'DOMException',
    ) as typeof DOMException;
    const SecondDOMException = Reflect.get(
      secondRealm.globalObject,
      'DOMException',
    ) as typeof DOMException;
    const source = new FirstDOMException('some message', 'IndexSizeError');
    Reflect.set(source, 'custom', 'not serialized');
    const sourceBinding = first.getObjectRecord(source);
    if (!sourceBinding) throw new Error('DOMException was not projected');
    const steps = sourceBinding.assembled.serialSteps;
    if (!steps) throw new Error('DOMException is not registered as serializable');
    const serialized = new StructuredData();

    steps.serializationSteps(
      sourceBinding.implInst,
      serialized,
      false,
      unusedSerializationContext,
    );
    const targetBinding = second.createPlatformRecord(
      sourceBinding.assembled.name,
    )!;
    steps.deserializationSteps(
      serialized,
      targetBinding.implInst,
      secondRealm,
      unusedDeserializationContext,
    );
    const clone = targetBinding.platformObject as StampedPlatformObject<DOMException>;

    expect(clone).toBeInstanceOf(SecondDOMException);
    expect(clone).not.toBeInstanceOf(FirstDOMException);
    expect(clone.name).toBe('IndexSizeError');
    expect(clone.message).toBe('some message');
    expect(clone.code).toBe(SecondDOMException.INDEX_SIZE_ERR);
    expect(Object.hasOwn(serialized.fields, 'Stack')).toBe(false);
    expect(Reflect.get(clone, 'custom')).toBeUndefined();
  });

  it('gives derived serializable interfaces standalone inherited-state steps', () => {
    const domain = new BindingWorld([]);
    const realm = createManualRealm();
    const registration = domain.register(realm, (ctx) => ({ realm: ctx.realm }));
    registration.install(realm.globalObject);
    const QuotaExceededError = Reflect.get(
      realm.globalObject,
      'QuotaExceededError',
    ) as QuotaExceededErrorConstructor;
    const source = new QuotaExceededError('too large', {
      quota: 12,
      requested: 20,
    });
    const sourceBinding = registration.getObjectRecord(source);
    if (!sourceBinding) throw new Error('QuotaExceededError was not projected');
    const steps = sourceBinding.assembled.serialSteps;
    if (!steps) {
      throw new Error('QuotaExceededError is not registered as serializable');
    }
    const serialized = new StructuredData();

    steps.serializationSteps(
      sourceBinding.implInst,
      serialized,
      true,
      unusedSerializationContext,
    );
    const targetBinding = registration.createPlatformRecord(
      sourceBinding.assembled.name,
    )!;
    steps.deserializationSteps(
      serialized,
      targetBinding.implInst,
      realm,
      unusedDeserializationContext,
    );
    const clone = targetBinding.platformObject as StampedPlatformObject<QuotaExceededError>;

    expect(clone).toBeInstanceOf(QuotaExceededError);
    expect(clone.name).toBe('QuotaExceededError');
    expect(clone.message).toBe('too large');
    expect(clone.quota).toBe(12);
    expect(clone.requested).toBe(20);
  });

  it('requires exact no-argument markers for declared structured-data steps', () => {
    const serialSteps: SerialSteps = {
      serializationSteps() {},
      deserializationSteps() {},
    };
    const transferSteps: TransferSteps = {
      transferSteps() {},
      transferReceivingSteps() {},
    };
    for (const [name, steps] of [
      ['Serializable', { serialSteps }],
      ['Transferable', { transferSteps }],
    ] as const) {
      const missingMarker = defineInterface({ name: 'MissingMarker', ...steps, members: [] });
      const malformed = defineInterface({
        name: 'MalformedMarker', ...steps,
        ...xattr({ arguments: [], kind: 'arguments', name }), members: [],
      });
      const duplicate = defineInterface({
        name: 'DuplicateMarker', ...steps, ...xattr(name, name), members: [],
      });
      const complete = defineInterface({
        name: 'Complete', ...steps, ...xattr(name), members: [],
      });

      for (const definition of [missingMarker, malformed, duplicate]) {
        expect(() => validateDefinitions([definition])).toThrow(
          'must declare exactly one [' + name + '] marker',
        );
      }
      expect(() => validateDefinitions([complete])).not.toThrow();
    }
  });

  it.each(['Serializable', 'Transferable'] as const)(
    'rejects [%s] outside a primary interface', (name) => {
      const primary = defineInterface({ name: 'Primary', members: [] });
      const misplaced: Definition[] = [
        definePartialInterface({ name: 'Primary', ...xattr(name), members: [] }),
        defineInterfaceMixin({ name: 'Mixin', ...xattr(name), members: [] }),
        defineDictionary({ name: 'Dictionary', ...xattr(name), members: [] }),
      ];
      for (const definition of misplaced) {
        expect(() => validateDefinitions([primary, definition]))
          .toThrow(`[${name}] requires a primary interface`);
      }
    },
  );

  it.each([['Serializable'], ['Transferable'], ['Serializable', 'Transferable']])(
    'allows [SameAgentCluster] alongside %s', (...markers) => {
      const definition = defineInterface({
        name: 'Restricted', ...xattr(...markers, 'SameAgentCluster'), members: [],
      });
      expect(() => validateDefinitions([definition])).not.toThrow();
    },
  );

  it.each<Definition>([
    defineInterface({ name: 'Missing', ...xattr('SameAgentCluster'), members: [] }),
    defineInterface({
      name: 'Duplicate', ...xattr('Serializable', 'SameAgentCluster', 'SameAgentCluster'), members: [],
    }),
    defineInterface({
      name: 'Malformed',
      ...xattr('Transferable', { kind: 'arguments', name: 'SameAgentCluster', arguments: [] }), members: [],
    }),
    definePartialInterface({ name: 'Primary', ...xattr('SameAgentCluster'), members: [] }),
    defineInterfaceMixin({ name: 'Mixin', ...xattr('SameAgentCluster'), members: [] }),
    defineDictionary({ name: 'Dictionary', ...xattr('SameAgentCluster'), members: [] }),
    defineInterface({ name: 'Derived', inherits: 'Primary', ...xattr('SameAgentCluster'), members: [] }),
  ])('rejects misplaced or malformed [SameAgentCluster] on $name', (definition) => {
    const primary = defineInterface({ name: 'Primary', ...xattr('Serializable'), members: [] });
    expect(() => validateDefinitions([primary, definition])).toThrow(/SameAgentCluster/);
  });

  it('does not inherit serialization or transfer permission from a parent interface', () => {
    class ParentImpl {}
    class ChildImpl extends ParentImpl {}
    const save = vi.fn();
    const move = vi.fn();
    const parent = defineInterface({
      name: 'Parent', exposed: '*', ...xattr('Serializable', 'Transferable'),
      implementation: impl(ParentImpl), members: [],
      serialSteps: { serializationSteps: save, deserializationSteps() {} },
      transferSteps: { transferSteps: move, transferReceivingSteps() {} },
    });
    const child = defineInterface({
      name: 'Child', inherits: 'Parent', exposed: '*',
      implementation: impl(ChildImpl), members: [],
    });
    const world = new BindingWorld<BrowletEnvironment>([parent, child]);
    const ctx = world.register(createManualRealm(), (ctx) => new SandboxEnvironment(ctx.realm, createBrowletExecution(ctx)));
    const value = ctx.createPlatformRecord(child.name)!.platformObject;

    expect(() => structuredSerialize(value, ctx)).toThrow(expect.objectContaining({ name: 'DataCloneError' }));
    expect(() => structuredSerializeWithTransfer(value, [value], ctx))
      .toThrow(expect.objectContaining({ name: 'DataCloneError' }));
    expect(save).not.toHaveBeenCalled();
    expect(move).not.toHaveBeenCalled();
  });

  it('keeps detached state private and instance-specific on frozen implementations', () => {
    const first = Object.freeze({});
    const second = {};

    expect(DetachedTransferableStamper.has(first)).toBe(false);
    DetachedTransferableStamper.stamp(first);
    expect(DetachedTransferableStamper.has(first)).toBe(true);
    expect(DetachedTransferableStamper.has(second)).toBe(false);
    expect(() => DetachedTransferableStamper.stamp(first)).not.toThrow();
    expect(Reflect.ownKeys(first)).toEqual([]);
    expect(Object.getPrototypeOf(first)).toBe(Object.prototype);
  });
});

const unusedSerializationContext: SerializationContext = {
  subserialize() {
    throw new Error('DOMException steps do not subserialize');
  },
};

const unusedDeserializationContext: DeserializationContext = {
  unwrap() {
    throw new Error('DOMException steps do not unwrap platform objects');
  },
  subdeserialize() {
    throw new Error('DOMException steps do not subdeserialize');
  },
};

type QuotaExceededError = DOMException & {
  quota: number | null;
  requested: number | null;
};

type QuotaExceededErrorConstructor = {
  new(message?: string, options?: {
    quota?: number;
    requested?: number;
  }): QuotaExceededError;
};
