import { describe, expect, it } from 'vitest';

import {
  getDOMExceptionRequest,
} from '../../../../../src/shared/dom-exception';
import {
  createBindings, defineInterface, impl, xattr,
} from '../../../../../src/web-idl/index';
import { Realm } from '../../../../../src/browlet/scripting/realm';
import {
  structuredDeserialize, type StructuredDeserializationEnvironment,
} from '../../../../../src/browlet/scripting/structured-data/deserialize';
import {
  domExceptionCapabilities,
} from '../../../../../src/browlet/integration/dom-exception';
import type {
  SerializedRecord,
} from '../../../../../src/browlet/scripting/structured-data/records';
import {
  serializable,
} from '../../../../../src/browlet/scripting/structured-data/serializable';
import {
  structuredSerialize, type StructuredSerializationEnvironment,
} from '../../../../../src/browlet/scripting/structured-data/serialize';

describe('HTML structured deserialization', () => {
  it('reconstructs primitive values and built-ins in the target realm', () => {
    const { source, sourceRealm, target, targetRealm } = createEnvironments();
    const values = sourceRealm.evaluate(`[
      undefined, null, false, -0, 2n, 'text',
      new Boolean(true), new Number(-0), Object(3n), new String('boxed'),
      new Date(1234), /a+/dgimsy,
    ]`, 'structured-deserialize-builtins.js') as unknown[];

    for (const value of values.slice(0, 6)) {
      const clone = cloneValue(value, source, target);
      expect(Object.is(clone, value)).toBe(true);
    }

    const boolean = cloneValue(values[6], source, target) as {
      valueOf(): boolean;
    };
    const number = cloneValue(values[7], source, target) as {
      valueOf(): number;
    };
    const bigint = cloneValue(values[8], source, target) as {
      valueOf(): bigint;
    };
    const string = cloneValue(values[9], source, target) as {
      valueOf(): string;
    };
    const date = cloneValue(values[10], source, target) as Date;
    const regexp = cloneValue(values[11], source, target) as RegExp;

    expect(Object.getPrototypeOf(boolean)).toBe(targetRealm.evaluate(
      'Boolean.prototype',
      'target-boolean-prototype.js',
    ));
    expect(Object.getPrototypeOf(number)).toBe(targetRealm.evaluate(
      'Number.prototype',
      'target-number-prototype.js',
    ));
    expect(Object.getPrototypeOf(bigint)).toBe(targetRealm.evaluate(
      'BigInt.prototype',
      'target-bigint-prototype.js',
    ));
    expect(Object.getPrototypeOf(string)).toBe(targetRealm.evaluate(
      'String.prototype',
      'target-string-prototype.js',
    ));
    expect(Object.getPrototypeOf(date)).toBe(targetRealm.evaluate(
      'Date.prototype',
      'target-date-prototype.js',
    ));
    expect(Object.getPrototypeOf(regexp)).toBe(targetRealm.evaluate(
      'RegExp.prototype',
      'target-regexp-prototype.js',
    ));
    expect(boolean.valueOf()).toBe(true);
    expect(Object.is(number.valueOf(), -0)).toBe(true);
    expect(bigint.valueOf()).toBe(3n);
    expect(string.valueOf()).toBe('boxed');
    expect(date.getTime()).toBe(1234);
    expect(regexp.source).toBe('a+');
    expect(regexp.flags).toBe('dgimsy');
  });

  it('reconstructs buffers and views in the target realm', () => {
    const { source, sourceRealm, target, targetRealm } = createEnvironments();
    const value = sourceRealm.evaluate(`(() => {
      const buffer = new ArrayBuffer(8, { maxByteLength: 16 });
      new Uint8Array(buffer).set([1, 2, 3, 4]);
      const fixed = new ArrayBuffer(2);
      new Uint8Array(fixed).set([5, 6]);
      return {
        buffer,
        dataView: new DataView(buffer, 1, 3),
        fixedAtEnd: new Uint16Array(buffer, 2, 3),
        fixedDataViewAtEnd: new DataView(buffer, 1, 7),
        fixed,
        tracking: new Uint16Array(buffer, 2),
        trackingDataView: new DataView(buffer, 1),
        view: new Uint16Array(buffer, 2, 2),
      };
    })()`, 'structured-deserialize-buffers.js') as object;
    const clone = cloneValue(value, source, target) as {
      buffer: ArrayBuffer;
      dataView: DataView;
      fixedAtEnd: Uint16Array;
      fixedDataViewAtEnd: DataView;
      fixed: ArrayBuffer;
      tracking: Uint16Array;
      trackingDataView: DataView;
      view: Uint16Array;
    };

    expect(Object.getPrototypeOf(clone.buffer)).toBe(targetRealm.evaluate(
      'ArrayBuffer.prototype',
      'target-array-buffer-prototype.js',
    ));
    expect(Object.getPrototypeOf(clone.view)).toBe(targetRealm.evaluate(
      'Uint16Array.prototype',
      'target-typed-array-prototype.js',
    ));
    expect(Object.getPrototypeOf(clone.dataView)).toBe(targetRealm.evaluate(
      'DataView.prototype',
      'target-data-view-prototype.js',
    ));
    expect(Object.getPrototypeOf(clone.fixed)).toBe(targetRealm.evaluate(
      'ArrayBuffer.prototype',
      'target-fixed-array-buffer-prototype.js',
    ));
    expect(clone.view.buffer).toBe(clone.buffer);
    expect(clone.dataView.buffer).toBe(clone.buffer);
    expect(clone.buffer.resizable).toBe(true);
    expect(clone.buffer.maxByteLength).toBe(16);
    expect([...new Uint8Array(clone.buffer).slice(0, 4)]).toEqual([1, 2, 3, 4]);
    expect([...new Uint8Array(clone.fixed)]).toEqual([5, 6]);
    expect(clone.dataView.byteOffset).toBe(1);
    expect(clone.dataView.byteLength).toBe(3);
    expect(clone.view.byteOffset).toBe(2);
    expect(clone.view.length).toBe(2);
    clone.buffer.resize(16);
    expect(clone.fixedAtEnd.length).toBe(3);
    expect(clone.fixedDataViewAtEnd.byteLength).toBe(7);
    expect(clone.tracking.length).toBe(7);
    expect(clone.trackingDataView.byteLength).toBe(15);
  });

  it('preserves SharedArrayBuffer backing stores within an agent cluster', () => {
    const agentCluster = {};
    const { source, sourceRealm, target } = createEnvironments({ agentCluster });
    const buffer = sourceRealm.evaluate(
      'new SharedArrayBuffer(4)',
      'structured-deserialize-shared-buffer.js',
    ) as SharedArrayBuffer;
    new Uint8Array(buffer)[0] = 7;

    const clone = cloneValue(buffer, source, target) as SharedArrayBuffer;
    expect(clone).not.toBe(buffer);
    expect(new Uint8Array(clone)[0]).toBe(7);
    new Uint8Array(clone)[0] = 9;
    expect(new Uint8Array(buffer)[0]).toBe(9);

    const growable = sourceRealm.evaluate(
      'new SharedArrayBuffer(4, { maxByteLength: 8 })',
      'structured-deserialize-growable-shared-buffer.js',
    ) as SharedArrayBuffer;
    const growableClone = cloneValue(
      growable,
      source,
      target,
    ) as SharedArrayBuffer;
    expect(growableClone.growable).toBe(true);
    expect(growableClone.maxByteLength).toBe(8);
    growableClone.grow(8);
    expect(growable.byteLength).toBe(8);

    const serialized = structuredSerialize(buffer, source);
    const otherCluster = createEnvironments().target;
    expectDataCloneError(() => structuredDeserialize(serialized, otherCluster));
  });

  it('creates SharedArrayBuffer wrappers with target-realm behavior', () => {
    const agentCluster = {};
    const { source, sourceRealm, target, targetRealm } = createEnvironments({
      agentCluster,
    });
    const buffer = sourceRealm.evaluate(
      'new SharedArrayBuffer(4)',
      'shared-buffer-target-realm.js',
    ) as SharedArrayBuffer;
    const clone = cloneValue(buffer, source, target) as SharedArrayBuffer;
    const TargetSharedArrayBuffer = targetRealm.evaluate(
      'SharedArrayBuffer',
      'target-shared-buffer-constructor.js',
    ) as SharedArrayBufferConstructor;
    const SourceSharedArrayBuffer = sourceRealm.evaluate(
      'SharedArrayBuffer',
      'source-shared-buffer-constructor.js',
    ) as SharedArrayBufferConstructor;

    expect(Object.getPrototypeOf(clone)).toBe(targetRealm.evaluate(
      'SharedArrayBuffer.prototype',
      'target-shared-buffer-prototype.js',
    ));
    expect(clone).toBeInstanceOf(TargetSharedArrayBuffer);
    expect(clone).not.toBeInstanceOf(SourceSharedArrayBuffer);

    const slice = clone.slice(0, 1);
    expect(slice).toBeInstanceOf(TargetSharedArrayBuffer);
    new Uint8Array(clone)[0] = 11;
    expect(new Uint8Array(buffer)[0]).toBe(11);
  });

  it.fails('preserves growable SharedArrayBuffer view length tracking', () => {
    const agentCluster = {};
    const { source, sourceRealm, target } = createEnvironments({ agentCluster });
    const value = sourceRealm.evaluate(`(() => {
      const buffer = new SharedArrayBuffer(4, { maxByteLength: 8 });
      return {
        buffer,
        fixed: new Uint8Array(buffer, 0, 4),
        tracking: new Uint8Array(buffer),
      };
    })()`, 'growable-shared-buffer-view.js');
    const clone = cloneValue(value, source, target) as {
      buffer: SharedArrayBuffer;
      fixed: Uint8Array;
      tracking: Uint8Array;
    };

    clone.buffer.grow(8);
    expect(clone.fixed.length).toBe(4);
    expect(clone.tracking.length).toBe(8);
  });

  it('preserves container prototypes, cycles, identity, and property shape', () => {
    const { source, target, targetRealm } = createEnvironments();
    const child = { value: 1 };
    const value: Record<string, unknown> = {
      array: new Array(3),
      child,
      map: new Map(),
      second: child,
      set: new Set(),
    };
    value.self = value;
    (value.array as unknown[])[1] = value;
    (value.map as Map<unknown, unknown>).set(child, value);
    (value.set as Set<unknown>).add(value);

    const clone = cloneValue(value, source, target) as typeof value;
    const array = clone.array as unknown[];
    const map = clone.map as Map<unknown, unknown>;
    const set = clone.set as Set<unknown>;

    expect(Object.getPrototypeOf(clone)).toBe(targetRealm.evaluate(
      'Object.prototype',
      'target-object-prototype.js',
    ));
    expect(Object.getPrototypeOf(array)).toBe(targetRealm.evaluate(
      'Array.prototype',
      'target-array-prototype.js',
    ));
    expect(Object.getPrototypeOf(map)).toBe(targetRealm.evaluate(
      'Map.prototype',
      'target-map-prototype.js',
    ));
    expect(Object.getPrototypeOf(set)).toBe(targetRealm.evaluate(
      'Set.prototype',
      'target-set-prototype.js',
    ));
    expect(clone.self).toBe(clone);
    expect(clone.child).toBe(clone.second);
    expect(array).toHaveLength(3);
    expect(Object.hasOwn(array, '0')).toBe(false);
    expect(array[1]).toBe(clone);
    expect(map.get(clone.child)).toBe(clone);
    expect(set.has(clone)).toBe(true);
  });

  it('restores native Error state with target-realm prototypes', () => {
    const { source, sourceRealm, target, targetRealm } = createEnvironments();
    const errors = sourceRealm.evaluate(`[
      new Error(), new EvalError('eval'), new RangeError('range'),
      new ReferenceError('reference'), new SyntaxError('syntax'),
      new TypeError('type'), new URIError('uri'),
    ]`, 'structured-deserialize-errors.js') as Error[];
    const names = [
      'Error', 'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError',
      'TypeError', 'URIError',
    ];

    for (const [index, error] of errors.entries()) {
      const clone = cloneValue(error, source, target) as Error;
      expect(Object.getPrototypeOf(clone)).toBe(targetRealm.evaluate(
        `${names[index]}.prototype`,
        `target-${names[index]}-prototype.js`,
      ));
      expect(clone.message).toBe(error.message);
      expect(clone.stack).toBe(error.stack);
    }
    const first = cloneValue(errors[0], source, target) as Error;
    expect(Object.hasOwn(first, 'message')).toBe(false);
  });

  it('restores Error cause in the target realm with graph identity', () => {
    const { source, target, targetRealm } = createEnvironments();
    const cause: Record<string, unknown> = { marker: 'cause' };
    const error = new TypeError('failed', { cause });
    cause.error = error;

    const clone = cloneValue(error, source, target) as Error & {
      cause: Record<string, unknown>;
    };

    expect(Object.hasOwn(clone, 'cause')).toBe(true);
    expect(clone.cause.marker).toBe('cause');
    expect(clone.cause.error).toBe(clone);
    expect(Object.getPrototypeOf(clone.cause)).toBe(targetRealm.evaluate(
      'Object.prototype',
      'target-error-cause-prototype.js',
    ));
  });

  it('restores only specified DOMException interface state', () => {
    const { source, sourceRealm, target, targetRealm } = createEnvironments();
    const SourceDOMException = Reflect.get(
      sourceRealm.global,
      'DOMException',
    ) as typeof DOMException;
    const TargetDOMException = Reflect.get(
      targetRealm.global,
      'DOMException',
    ) as typeof DOMException;
    const SourceQuotaExceededError = Reflect.get(
      sourceRealm.global,
      'QuotaExceededError',
    ) as QuotaExceededErrorConstructor;
    const TargetQuotaExceededError = Reflect.get(
      targetRealm.global,
      'QuotaExceededError',
    ) as QuotaExceededErrorConstructor;
    const exception = new SourceDOMException('bad index', 'IndexSizeError');
    const quota = new SourceQuotaExceededError('too large', {
      quota: 10,
      requested: 12,
    });
    Reflect.set(exception, 'custom', true);
    Reflect.set(quota, 'custom', true);

    const exceptionClone = cloneValue(exception, source, target) as DOMException;
    const quotaClone = cloneValue(quota, source, target) as QuotaExceededError;

    expect(exceptionClone).toBeInstanceOf(TargetDOMException);
    expect(exceptionClone).not.toBeInstanceOf(SourceDOMException);
    expect(exceptionClone.name).toBe('IndexSizeError');
    expect(exceptionClone.message).toBe('bad index');
    expect(Reflect.get(exceptionClone, 'custom')).toBeUndefined();
    expect(quotaClone).toBeInstanceOf(TargetQuotaExceededError);
    expect(quotaClone).not.toBeInstanceOf(SourceQuotaExceededError);
    expect(quotaClone.message).toBe('too large');
    expect(quotaClone.quota).toBe(10);
    expect(quotaClone.requested).toBe(12);
    expect(Reflect.get(quotaClone, 'custom')).toBeUndefined();
  });

  it('creates exact platform interfaces and runs sub-deserialization', () => {
    class ContainerImpl {
      child: unknown;

      constructor() {
        this.child = this;
      }
    }

    const containerIDL = defineInterface({
      name: 'SerializableContainer',
      exposed: '*',
      ...xattr('Serializable'),
      implementation: impl(ContainerImpl),
      members: [],
    });
    const capabilities = [serializable.for(containerIDL, {
      serializationSteps(value, record, _forStorage, context) {
        record.set(
          'Child',
          context.subserialize((value as ContainerImpl).child),
        );
      },
      deserializationSteps(record, value, _targetRealm, context) {
        (value as ContainerImpl).child = context.subdeserialize(
          record.get('Child'),
        );
      },
    })];
    const bindings = createBindings([containerIDL], { capabilities });
    const sourceRealm = new Realm();
    const targetRealm = new Realm();
    const sourceRegistration = bindings.register(sourceRealm);
    const targetRegistration = bindings.register(targetRealm);
    const agentCluster = {};
    const source: StructuredSerializationEnvironment = {
      agentCluster,
      context: sourceRegistration.context,
      realm: sourceRealm,
    };
    const target: StructuredDeserializationEnvironment = {
      agentCluster,
      context: targetRegistration.context,
      realm: targetRealm,
    };
    const original = sourceRegistration.context.createPlatformObject(containerIDL);
    (original.implementation as ContainerImpl).child = original.platformObject;

    const clone = cloneValue(original.platformObject, source, target);
    const resolved = targetRegistration.context.resolvePlatformObject(clone);
    expect(resolved?.primaryInterface.definition).toBe(containerIDL);
    expect((resolved?.implementation as ContainerImpl).child).toBe(clone);
  });

  it('rejects unavailable platform interfaces and reuses caller memory', () => {
    const { target } = createEnvironments();
    const missing: SerializedRecord = {
      type: 'platform-object',
      fields: new Map(),
      interfaceName: 'MissingInterface',
    };
    expectDataCloneError(() => structuredDeserialize(missing, target));

    const record: SerializedRecord = { type: 'Object', properties: [] };
    const remembered = {};
    const memory = new Map<SerializedRecord, unknown>([[record, remembered]]);
    expect(structuredDeserialize(record, target, memory)).toBe(remembered);
  });
});

function createEnvironments(options: {
  agentCluster?: object;
} = {}): {
  source: StructuredSerializationEnvironment;
  sourceRealm: Realm;
  target: StructuredDeserializationEnvironment;
  targetRealm: Realm;
} {
  const bindings = createBindings([], {
    capabilities: domExceptionCapabilities,
  });
  const sourceRealm = new Realm({ crossOriginIsolated: true });
  const targetRealm = new Realm({ crossOriginIsolated: true });
  const sourceRegistration = bindings.register(sourceRealm);
  const targetRegistration = bindings.register(targetRealm);
  sourceRegistration.install(sourceRealm.global);
  targetRegistration.install(targetRealm.global);
  const agentCluster = options.agentCluster ?? {};
  return {
    source: {
      agentCluster,
      context: sourceRegistration.context,
      realm: sourceRealm,
    },
    sourceRealm,
    target: {
      agentCluster,
      context: targetRegistration.context,
      realm: targetRealm,
    },
    targetRealm,
  };
}

function cloneValue(
  value: unknown,
  source: StructuredSerializationEnvironment,
  target: StructuredDeserializationEnvironment,
): unknown {
  return structuredDeserialize(structuredSerialize(value, source), target);
}

function expectDataCloneError(steps: () => unknown): void {
  try {
    steps();
  } catch (error) {
    expect(getDOMExceptionRequest(error)).toEqual({
      message: '',
      name: 'DataCloneError',
    });
    return;
  }
  throw new Error('Expected a DataCloneError DOMException');
}

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
