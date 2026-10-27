import { describe, expect, it } from 'vitest';

import {
  arg, attr, ctor, defineDictionary, defineInterface, defineProxyObject, dictMember,
  idlType, impl, nullable, op, reference, roAttr, union,
} from '../../../src/web-idl/core/index';
import { BindingWorld } from '../../../src/web-idl/binding/world';

import { installTestBindings } from '../../support/web-idl-binding';

describe('Web IDL proxy handle binding', () => {
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
