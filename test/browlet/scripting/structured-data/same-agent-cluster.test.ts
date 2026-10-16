import { describe, expect, it, vi } from 'vitest';
import { createManualRealm } from '../../../support/browlet-agent';
import { AgentCluster } from '../../../../src/browlet/scripting/agents';
import { SandboxEnvironment, type BrowletEnvironment } from '../../../../src/browlet/environment';
import { createBrowletExecution } from '../../../../src/browlet/bindings';
import {
  structuredSerialize, structuredSerializeForStorage,
} from '../../../../src/browlet/scripting/structured-data/serialize';
import { structuredDeserialize } from '../../../../src/browlet/scripting/structured-data/deserialize';
import {
  structuredSerializeWithTransfer, structuredDeserializeWithTransfer,
} from '../../../../src/browlet/scripting/structured-data/transfer';
import {
  BindingWorld, defineInterface, impl, xattr, type SerialSteps, type TransferSteps,
} from '../../../../src/web-idl/index';

describe('HTML same-agent-cluster structured data', () => {
  it('reconstructs a marked object in another agent of the same cluster', () => {
    const { source, peer, create } = createContexts();
    const value = create('ClusterResource');
    const serialized = structuredSerialize(value, source);
    const clone = structuredDeserialize(serialized, peer);

    expect(source.realm.agent).not.toBe(peer.realm.agent);
    expect(source.realm.agent.agentCluster).toBe(peer.realm.agent.agentCluster);
    expect(clone).not.toBe(value);
    expect(peer.getObjectRecord(clone)?.realm).toBe(peer.realm);
    expect(peer.unwrap(clone, ResourceImpl)?.value).toBe(42);
  });

  it.each(['serialization', 'transfer'] as const)('supplies the primary interface restriction to %s steps', (mode) => {
    const { source, create, save, transfer } = createContexts();
    for (const name of ['ClusterResource', 'Resource', 'DerivedResource']) {
      const value = create(name);
      if (mode === 'serialization') structuredSerialize(value, source);
      else structuredSerializeWithTransfer(value, [value], source);
    }

    const hook = mode === 'serialization' ? save : transfer;
    expect(hook.mock.calls).toEqual([[true], [false], [false]]);
  });

  it('rejects a marked object before allocating or restoring it in another cluster', () => {
    const { source, foreign, create, restore } = createContexts();
    const serialized = structuredSerialize(create('ClusterResource'), source);
    const allocate = vi.spyOn(foreign, 'createPlatformRecord');

    expect(() => structuredDeserialize(serialized, foreign)).toThrow(dataCloneError);
    expect(allocate).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
  });

  it('rejects storage after running the marked interface serialization steps', () => {
    const { source, create, save } = createContexts();

    expect(() => structuredSerializeForStorage(create('ClusterResource'), source))
      .toThrow(dataCloneError);
    expect(save).toHaveBeenCalledOnce();
  });

  it('uses the serializing agent cluster rather than the object owner', () => {
    const { source, peer, foreign } = createContexts();
    const value = foreign.createPlatformRecord('ClusterResource')!.platformObject;
    const serialized = structuredSerialize(value, source);

    expect(() => structuredDeserialize(serialized, peer)).not.toThrow();
    expect(() => structuredDeserialize(serialized, foreign)).toThrow(dataCloneError);
  });

  it('allows interface steps to restrict individual serialized objects', () => {
    const { source, peer, foreign, create } = createContexts();
    const restricted = create('Resource', true);
    const serialized = structuredSerialize(restricted, source);

    expect(() => structuredDeserialize(serialized, peer)).not.toThrow();
    expect(() => structuredDeserialize(serialized, foreign)).toThrow(dataCloneError);
    expect(() => structuredSerializeForStorage(restricted, source)).toThrow(dataCloneError);
    expect(() => structuredSerializeForStorage(create('Resource'), source)).not.toThrow();
  });

  it('does not inherit the restriction from a parent interface', () => {
    const { source, foreign, create } = createContexts();
    const value = create('DerivedResource');
    const serialized = structuredSerializeForStorage(value, source);

    expect(() => structuredDeserialize(serialized, foreign)).not.toThrow();
    const transferred = structuredSerializeWithTransfer(value, [value], source);
    expect(() => structuredDeserializeWithTransfer(transferred, foreign)).not.toThrow();
  });

  it.each(['marker', 'steps'] as const)('restricts transfer through %s', (mode) => {
    const { source, peer, foreign, create, receive } = createContexts();
    const value = create(mode === 'marker' ? 'ClusterResource' : 'Resource', mode === 'steps');
    const serialized = structuredSerializeWithTransfer({ value }, [value], source);

    expect(() => structuredDeserializeWithTransfer(serialized, foreign)).toThrow(dataCloneError);
    expect(receive).not.toHaveBeenCalled();
    const result = structuredDeserializeWithTransfer(serialized, peer);
    expect(result.deserialized).toEqual({ value: result.transferredValues[0] });
    expect(peer.unwrap(result.transferredValues[0], ResourceImpl)?.value).toBe(42);
    expect(receive).toHaveBeenCalledOnce();
  });

  it('checks restrictions in the serialized graph before receiving unrelated transfers', () => {
    const { source, peer, foreign, create, receive } = createContexts();
    const frame = create('ClusterResource');
    const port = create('Resource');
    const graph: { nested: object; self?: object; } = { nested: new Map([[frame, frame]]) };
    graph.self = graph;
    const serialized = structuredSerializeWithTransfer(graph, [port], source);

    expect(() => structuredDeserializeWithTransfer(serialized, foreign)).toThrow(dataCloneError);
    expect(receive).not.toHaveBeenCalled();
    const result = structuredDeserializeWithTransfer(serialized, peer);
    const clone = result.deserialized as typeof graph;
    expect(clone.self).toBe(clone);
    expect(receive).toHaveBeenCalledOnce();
  });

  it('includes nested shared memory in the check before transfer receiving', () => {
    const { source, foreign, create, receive } = createContexts();
    const port = create('Resource');
    const serialized = structuredSerializeWithTransfer(
      { nested: new Set([new SharedArrayBuffer(4)]) }, [port], source,
    );

    expect(() => structuredDeserializeWithTransfer(serialized, foreign)).toThrow(dataCloneError);
    expect(receive).not.toHaveBeenCalled();
  });

  it.each(['serialized', 'transferred'] as const)(
    'checks exposure of %s objects before receiving any transfers', (mode) => {
      const { source, hidden, create, receive } = createContexts();
      const port = create('Resource');
      const value = create('HiddenResource');
      const serialized = structuredSerializeWithTransfer(
        { value }, mode === 'serialized' ? [port] : [port, value], source,
      );

      expect(() => structuredDeserializeWithTransfer(serialized, hidden)).toThrow(dataCloneError);
      expect(receive).not.toHaveBeenCalled();
    },
  );

  it('summarizes platform interfaces in transfer and graph order without duplicates', () => {
    const { source, create } = createContexts();
    const port = create('Resource');
    const hidden = create('HiddenResource');
    const frame = create('ClusterResource');
    const serialized = structuredSerializeWithTransfer([hidden, frame, hidden, port], [port], source);

    expect([...serialized.interfaceNames]).toEqual(['Resource', 'HiddenResource', 'ClusterResource']);
    expect(serialized.cluster).toBe(source.realm.agent.agentCluster);
  });

  it.each(['cluster', 'exposure'] as const)('does not consume buffer holders on a %s rejection', (reason) => {
    const { source, peer, foreign, hidden, create } = createContexts();
    const buffer = new Uint8Array([1, 2, 3]).buffer;
    const value = create(reason === 'cluster' ? 'ClusterResource' : 'HiddenResource');
    const serialized = structuredSerializeWithTransfer({ value, buffer }, [buffer], source);

    expect(buffer.byteLength).toBe(0);
    expect(() => structuredDeserializeWithTransfer(serialized, reason === 'cluster' ? foreign : hidden))
      .toThrow(dataCloneError);
    const result = structuredDeserializeWithTransfer(serialized, peer);
    const received = result.transferredValues[0] as ArrayBuffer;
    expect([...new Uint8Array(received)]).toEqual([1, 2, 3]);
    expect(result.deserialized).toHaveProperty('buffer', received);
  });
});

const dataCloneError: unknown = expect.objectContaining({ name: 'DataCloneError' });

class ResourceImpl {
  value = 42;
  restricted = false;
}
class ClusterResourceImpl extends ResourceImpl {}
class DerivedResourceImpl extends ClusterResourceImpl {}
class HiddenResourceImpl extends ResourceImpl {}

function createContexts() {
  const save = vi.fn();
  const restore = vi.fn();
  const transfer = vi.fn();
  const receive = vi.fn();
  const serialSteps: SerialSteps<ResourceImpl, { Value: number; }> = {
    serializationSteps(value, serialized) {
      save(serialized.shouldRestrict);
      serialized.fields.Value = value.value;
      if (value.restricted) serialized.shouldRestrict = true;
    },
    deserializationSteps(serialized, value) {
      restore();
      value.value = serialized.fields.Value;
    },
  };
  const transferSteps: TransferSteps<ResourceImpl, { Value: number; }> = {
    transferSteps(value, dataHolder) {
      transfer(dataHolder.shouldRestrict);
      dataHolder.fields.Value = value.value;
      if (value.restricted) dataHolder.shouldRestrict = true;
    },
    transferReceivingSteps(dataHolder, value) {
      receive();
      value.value = dataHolder.fields.Value;
    },
  };
  const world = new BindingWorld<BrowletEnvironment>([
    defineInterface({
      name: 'Resource', exposed: 'ResourceTest', implementation: impl(ResourceImpl),
      ...xattr('Serializable', 'Transferable'), serialSteps, transferSteps, members: [],
    }),
    defineInterface({
      name: 'ClusterResource', inherits: 'Resource', exposed: 'ResourceTest',
      implementation: impl(ClusterResourceImpl),
      ...xattr('Serializable', 'Transferable', 'SameAgentCluster'),
      serialSteps, transferSteps, members: [],
    }),
    defineInterface({
      name: 'DerivedResource', inherits: 'ClusterResource', exposed: 'ResourceTest',
      implementation: impl(DerivedResourceImpl),
      ...xattr('Serializable', 'Transferable'), serialSteps, transferSteps, members: [],
    }),
    defineInterface({
      name: 'HiddenResource', inherits: 'Resource', exposed: 'HiddenTest',
      implementation: impl(HiddenResourceImpl),
      ...xattr('Serializable', 'Transferable'), serialSteps, transferSteps, members: [],
    }),
  ]);
  const cluster = new AgentCluster('concrete');
  function register(agentCluster = cluster, globalNames = ['ResourceTest', 'HiddenTest']) {
    const realm = createManualRealm({ globalNames, crossOriginIsolated: true });
    agentCluster.add(realm.agent);
    return world.register(realm, (ctx) => new SandboxEnvironment(ctx.realm, createBrowletExecution(ctx)));
  }
  const source = register();
  return {
    source, peer: register(), foreign: register(new AgentCluster('concrete')),
    hidden: register(cluster, ['ResourceTest']), save, restore, transfer, receive,
    create: (name: string, restricted = false) => {
      const record = source.createPlatformRecord(name)!;
      source.unwrap(record.platformObject, ResourceImpl)!.restricted = restricted;
      return record.platformObject;
    },
  };
}
