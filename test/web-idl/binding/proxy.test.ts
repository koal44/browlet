import { describe, expect, it } from 'vitest';

import {
  arg, attr, ctor, defineDictionary, defineInterface, defineProxyObject, dictMember,
  idlType, impl, nullable, op, reference, roAttr, union,
} from '../../../src/web-idl/core/index';
import { BindingWorld } from '../../../src/web-idl/binding/world';
import { PlatformRecordSource } from '../../../src/web-idl/values/index';

import { installTestBindings } from '../../support/web-idl-binding';

describe('Web IDL proxy handle binding', () => {
  it('resolves interface inputs to the current platform object without changing retained arguments', () => {
    const proxy = {};
    const handle = { current: undefined as object | undefined };
    class PeerImpl {
      value: number;
      constructor(value: number) { this.value = value; }
    }
    class ConsumerImpl {
      retained: PeerImpl | undefined;
      read(value: PeerImpl | string): number {
        if (typeof value === 'string') return -1;
        this.retained = value;
        return value.value;
      }
      readUnion(value: PeerImpl | string): number { return this.read(value); }
      readOverload(value: PeerImpl | string): number { return this.read(value); }
    }
    const peerType = reference('Peer');
    const world = new BindingWorld([
      defineProxyObject({
        name: 'HostProxy',
        getHandle: (value) => value === proxy ? handle : undefined,
        getProxy: (value) => value === handle ? proxy : undefined,
        resolveReceiver: (value) => value.current,
      }),
      defineInterface({ name: 'Peer', implementation: impl(PeerImpl), members: [] }),
      defineInterface({
        name: 'Consumer', exposed: '*', implementation: impl(ConsumerImpl), members: [
          ctor(),
          op('read', idlType.long, [arg('value', peerType)]),
          op('readUnion', idlType.long, [arg('value', union(peerType, idlType.DOMString))]),
          op('readOverload', idlType.long, [arg('value', peerType)]),
          op('readOverload', idlType.long, [arg('value', idlType.DOMString)]),
        ],
      }),
    ]);
    const { globalObject, context, realm } = installTestBindings(world);
    const Consumer = Reflect.get(globalObject, 'Consumer') as new() => {
      read(value: object): number;
      readUnion(value: object): number;
      readOverload(value: object): number;
    };
    const consumer = new Consumer();
    const implementation = context.unwrap(consumer, ConsumerImpl)!;
    const first = new PeerImpl(5);
    handle.current = context.project(PeerImpl, first)!;
    expect(context.getPlatformRecord(proxy, PlatformRecordSource.Platform)).toBeUndefined();
    expect(context.getPlatformRecord(proxy, PlatformRecordSource.Stamped)).toBeUndefined();
    expect(context.getPlatformRecord(proxy, PlatformRecordSource.PlatformOrProxy)?.implInst).toBe(first);
    expect(consumer.read(proxy)).toBe(5);
    expect(consumer.readUnion(proxy)).toBe(5);
    expect(consumer.readOverload(proxy)).toBe(5);

    const next = new PeerImpl(9);
    const other = installTestBindings(world);
    handle.current = other.context.project(PeerImpl, next)!;
    expect(implementation.retained).toBe(first);
    expect(consumer.read(proxy)).toBe(9);
    expect(implementation.retained).toBe(next);
    for (const invalid of [handle, next, new Proxy(proxy, {}), Object.create(proxy) as object]) {
      expect(() => consumer.read(invalid)).toThrow(realm.TypeError);
    }

    const foreign = installTestBindings(new BindingWorld([
      defineInterface({ name: 'Peer', implementation: impl(PeerImpl), members: [] }),
    ]));
    handle.current = foreign.context.project(PeerImpl, new PeerImpl(1))!;
    expect(() => consumer.read(proxy)).toThrow(realm.TypeError);
  });

  it('shares one handle representation across dictionary inputs, members, and interface unions', () => {
    const proxy = Object.freeze({});
    const handle = { platform: proxy };
    class PeerImpl {}
    type Source = typeof handle | PeerImpl | null;
    class ConsumerImpl {
      source: Source;
      untouched: unknown;

      constructor(init: { source: Source; untouched?: unknown; }) {
        this.source = init.source;
        this.untouched = init.untouched;
      }

      echo(source: Source): Source { this.source = source; return source; }
    }
    const sourceType = nullable(union(reference('HostProxy'), reference(PeerImpl)));
    const world = new BindingWorld([
      defineProxyObject({
        name: 'HostProxy',
        getHandle: (value) => value === proxy ? handle : undefined,
        getProxy: (value) => value === handle ? proxy : undefined,
      }),
      defineInterface({ name: 'Peer', implementation: impl(PeerImpl), members: [] }),
      defineDictionary({
        name: 'SourceInit', members: [
          dictMember('source', sourceType, { default: null }),
          dictMember('untouched', idlType.any),
        ],
      }),
      defineInterface({
        name: 'Consumer', exposed: '*', implementation: impl(ConsumerImpl),
        members: [
          ctor([arg('init', reference('SourceInit'))]),
          attr('source', sourceType),
          roAttr('untouched', idlType.any),
          op('echo', sourceType, [arg('source', sourceType)]),
        ],
      }),
    ]);
    const { globalObject, context, realm } = installTestBindings(world);
    const Consumer = Reflect.get(globalObject, 'Consumer') as new(init: { source?: object | null; untouched?: unknown; }) => {
      source: object | null;
      untouched: unknown;
      echo(source: object | null): object | null;
    };
    const consumer = new Consumer({ source: proxy, untouched: proxy });
    const implementation = context.unwrap(consumer, ConsumerImpl)!;

    expect(implementation.source).toBe(handle);
    expect(implementation.untouched).toBe(proxy);
    expect(consumer.source).toBe(proxy);
    expect(consumer.untouched).toBe(proxy);
    expect(consumer.echo(proxy)).toBe(proxy);
    expect(implementation.source).toBe(handle);

    const peer = new PeerImpl();
    const platformPeer = context.project(PeerImpl, peer);
    consumer.source = platformPeer;
    expect(implementation.source).toBe(peer);
    expect(consumer.source).toBe(platformPeer);
    expect(consumer.echo(platformPeer)).toBe(platformPeer);

    consumer.source = proxy;
    expect(implementation.source).toBe(handle);
    expect(consumer.source).toBe(proxy);
    consumer.source = null;
    expect(implementation.source).toBeNull();
    expect(consumer.source).toBeNull();
    expect(new Consumer({}).source).toBeNull();
    expect(() => { consumer.source = handle; }).toThrow(realm.TypeError);
    expect(() => new Consumer({ source: {} })).toThrow(realm.TypeError);
  });
});
