import { createManualEventLoop } from '../../support/browlet-agent';
import { describe, expect, it, vi } from 'vitest';
import { UserAgent } from '../../../src/browlet/user-agent';
import { Browlet } from '../../../src/browlet/browlet';
import { BrowsingContextGroup } from '../../../src/browlet/browsing/navigation/browsing-context';

import {
  Agent, AgentCluster, DedicatedWorkerAgent,
  ServiceWorkerAgent, SharedWorkerAgent, WindowAgent, WorkletAgent,
} from '../../../src/browlet/scripting/agents';
import { BrowletRealm } from '../../../src/browlet/scripting/realm';
import { networkingTaskSource } from '../../../src/browlet/scripting/tasks';
import type { Domain, Host, TupleOrigin } from '../../../src/url/core/index';
import { itPassesWith } from '../../test-runtime';

describe('WindowAgent', () => {
  it('contains window objects and records the nonblocking policy', () => {
    const agent = new WindowAgent(createManualEventLoop());

    expect(agent.canBlock).toBe(false);
    expect(agent.windowObjects).toEqual(new Set());
  });

  // TODO(HTML §8.1.2.1): wire the Window's nonblocking policy into the execution backend.
  it.fails('rejects Atomics.wait in a Window even with a zero timeout', async () => {
    const browlet = new Browlet({ route: () => '' });
    const result = await browlet.evaluate(() => {
      // WebAssembly exposes a shared buffer even when the constructor is hidden.
      const memory = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
      const view = new Int32Array(memory.buffer);
      try {
        // A matching value reaches the blocking-policy check. Zero prevents a hang.
        return Atomics.wait(view, 0, 0, 0);
      } catch (error) {
        if (error instanceof TypeError) return 'TypeError';
        throw error;
      }
    });

    expect(result).toBe('TypeError');
  });
});

describe('worker and worklet agents', () => {
  it('fixes each agent type\'s blocking policy', () => {
    expect(new DedicatedWorkerAgent(createManualEventLoop()).canBlock).toBe(true);
    expect(new SharedWorkerAgent(createManualEventLoop()).canBlock).toBe(true);
    expect(new ServiceWorkerAgent(createManualEventLoop()).canBlock).toBe(false);
    expect(new WorkletAgent(createManualEventLoop()).canBlock).toBe(false);
  });

  it('reserves each agent\'s single global scope association', () => {
    expect(new DedicatedWorkerAgent(createManualEventLoop()).globalScope).toBeUndefined();
    expect(new SharedWorkerAgent(createManualEventLoop()).globalScope).toBeUndefined();
    expect(new ServiceWorkerAgent(createManualEventLoop()).globalScope).toBeUndefined();
    expect(new WorkletAgent(createManualEventLoop()).globalScope).toBeUndefined();
  });
});

describe('Agent', () => {
  it('has a unique signifier and event loop', () => {
    const first = new WindowAgent(createManualEventLoop());
    const second = new WindowAgent(createManualEventLoop());

    expect(first.signifier).not.toBe(second.signifier);
    expect(first.eventLoop).not.toBe(second.eventLoop);
  });

  it('reports lock-free and byte-order facts observed in author code', async () => {
    const browlet = new Browlet({ route: () => '' });
    const facts = await browlet.evaluate(() => ({
      isLockFree1: Atomics.isLockFree(1),
      isLockFree2: Atomics.isLockFree(2),
      isLockFree8: Atomics.isLockFree(8),
      littleEndian: new Uint8Array(new Uint16Array([1]).buffer)[0] === 1,
    }));
    const agent = new WindowAgent(createManualEventLoop());

    expect({
      isLockFree1: agent.isLockFree1,
      isLockFree2: agent.isLockFree2,
      isLockFree8: agent.isLockFree8,
      littleEndian: agent.littleEndian,
    }).toEqual(facts);
  });
});

describe('AgentCluster', () => {
  it('starts without origin keying or cross-origin isolation', () => {
    const cluster = new AgentCluster();

    expect(cluster.agents.size).toBe(0);
    expect(cluster.isOriginKeyed).toBe(false);
    expect(cluster.crossOriginIsolationMode).toBe('none');
  });

  it('retains permanent membership without adding an agent to a second cluster', () => {
    const first = new AgentCluster();
    const second = new AgentCluster();
    const agent = new WindowAgent(createManualEventLoop());
    first.add(agent);
    first.add(agent);

    expect(() => second.add(agent)).toThrow('An agent cannot move between agent clusters');
    expect(agent.agentCluster).toBe(first);
    expect(first.agents.size).toBe(1);
    expect(second.agents.size).toBe(0);
  });
});

describe('worker/worklet agent allocation (records only)', () => {
  it('puts dedicated workers and worklets in the creator\'s cluster with distinct loops', () => {
    const userAgent = new UserAgent();
    const [, document] = BrowsingContextGroup.create(userAgent);
    const env = document.env;
    const owner = env.realm.agent;
    const cluster = owner.agentCluster!;
    cluster.crossOriginIsolationMode = 'concrete';
    const worker = userAgent.obtainDedicatedOrSharedWorkerAgent(env, false);
    const otherWorker = userAgent.obtainDedicatedOrSharedWorkerAgent(env, false);
    const worklet = userAgent.obtainWorkletAgent(env);

    expect(worker).toBeInstanceOf(DedicatedWorkerAgent);
    expect(worklet).toBeInstanceOf(WorkletAgent);
    expect(worker.canBlock).toBe(true);
    expect(worklet.canBlock).toBe(false);
    for (const agent of [worker, otherWorker, worklet]) {
      expect(agent.agentCluster).toBe(cluster);
      expect(agent.agentCluster!.crossOriginIsolationMode).toBe('concrete');
    }
    expect(cluster.agents).toEqual(new Set([owner, worker, otherWorker, worklet]));
    expect(new Set([...cluster.agents].map((agent) => agent.eventLoop)).size).toBe(4);
  });

  it('gives shared and service workers fresh origin-keyed clusters with default isolation', () => {
    const userAgent = new UserAgent();
    const [, document] = BrowsingContextGroup.create(userAgent);
    const env = document.env;
    env.realm.agent.agentCluster!.crossOriginIsolationMode = 'concrete';
    const shared = userAgent.obtainDedicatedOrSharedWorkerAgent(env, true);
    const otherShared = userAgent.obtainDedicatedOrSharedWorkerAgent(env, true);
    const service = userAgent.obtainServiceWorkerAgent();

    expect(shared).toBeInstanceOf(SharedWorkerAgent);
    expect(service).toBeInstanceOf(ServiceWorkerAgent);
    expect(shared.canBlock).toBe(true);
    expect(service.canBlock).toBe(false);
    for (const agent of [shared, otherShared, service]) {
      expect(agent.agentCluster!.agents).toEqual(new Set([agent]));
      expect(agent.agentCluster!.isOriginKeyed).toBe(true);
      expect(agent.agentCluster!.crossOriginIsolationMode).toBe('none');
      expect(agent.eventLoop).not.toBe(env.responsibleEventLoop);
    }
    expect(new Set([
      env.realm.agent.agentCluster, shared.agentCluster, otherShared.agentCluster, service.agentCluster,
    ]).size).toBe(4);
  });
});

describe('BrowsingContextGroup.obtainSimilarOriginWindowAgent', () => {
  it('runs Window and sandbox tasks with automatic host scheduling', async () => {
    const userAgent = new UserAgent();
    const group = userAgent.createBrowsingContextGroup();
    const origin = createTupleOrigin('https', createHost('example.com'));
    const agent = group.obtainSimilarOriginWindowAgent(origin, false);

    for (const loop of [agent.eventLoop, userAgent.sandbox.responsibleEventLoop]) {
      const completed = Promise.withResolvers<void>();
      const task = vi.fn(() => { completed.resolve(); });
      loop.queueTask(networkingTaskSource, null, task);
      expect(task).not.toHaveBeenCalled();
      await completed.promise;
      expect(task).toHaveBeenCalledOnce();
    }
  });

  it('creates one Window Agent per cluster with a separate event loop', () => {
    const userAgent = new UserAgent();
    const createAgent = vi.spyOn(userAgent, 'createWindowAgent');
    const group = userAgent.createBrowsingContextGroup();
    const origin = createTupleOrigin('https', createHost('example.com'));

    const first = group.obtainSimilarOriginWindowAgent(origin, false);
    const second = group.obtainSimilarOriginWindowAgent(origin, false);
    expect(first.eventLoop).not.toBe(userAgent.sandbox.responsibleEventLoop);
    expect(second).toBe(first);
    expect(createAgent).toHaveBeenCalledOnce();
  });

  it('creates a site-keyed cluster by default', () => {
    const origin = createTupleOrigin('https', createHost('example.com'));
    const group = new UserAgent().createBrowsingContextGroup();

    const agent = group.obtainSimilarOriginWindowAgent(origin, false);
    const key = group.historicalAgentClusterKeyMap.get(origin)!;
    const agentCluster = group.agentClusterMap.get(key)!;

    expect(agent).toBeInstanceOf(WindowAgent);
    expect(agentCluster.crossOriginIsolationMode).toBe('none');
    expect(agentCluster.isOriginKeyed).toBe(false);
    expect(agentCluster.agents).toEqual(new Set([agent]));
    expect(agent.agentCluster).toBe(agentCluster);
  });

  it('retains the historical site key when OAC is requested later', () => {
    const origin = createTupleOrigin('https', createHost('example.com'));
    const group = new UserAgent().createBrowsingContextGroup();

    const first = group.obtainSimilarOriginWindowAgent(origin, false);
    const second = group.obtainSimilarOriginWindowAgent(origin, true);

    expect(second).toBe(first);
  });

  it('creates an origin-keyed cluster when OAC is requested first', () => {
    const origin = createTupleOrigin('https', createHost('example.com'));
    const group = new UserAgent().createBrowsingContextGroup();

    const agent = group.obtainSimilarOriginWindowAgent(origin, true);
    const agentCluster = group.agentClusterMap.get(origin)!;

    expect(agentCluster.isOriginKeyed).toBe(true);
    expect(agentCluster.agents).toContain(agent);
    expect(group.obtainSimilarOriginWindowAgent(origin, false)).toBe(agent);
  });

  it('separates the same origin in different browsing context groups', () => {
    const userAgent = new UserAgent();
    const origin = createTupleOrigin('https', createHost('example.com'));
    const first = userAgent.createBrowsingContextGroup().obtainSimilarOriginWindowAgent(origin, false);
    const second = userAgent.createBrowsingContextGroup().obtainSimilarOriginWindowAgent(origin, false);

    expect(second).not.toBe(first);
    expect(second.agentCluster).not.toBe(first.agentCluster);
  });

  it('creates an origin-keyed cluster for a cross-origin-isolated group', () => {
    const origin = createTupleOrigin('https', createHost('example.com'));
    const group = new UserAgent().createBrowsingContextGroup();
    group.crossOriginIsolationMode = 'logical';

    const agent = group.obtainSimilarOriginWindowAgent(origin, false);
    const agentCluster = group.agentClusterMap.get(origin)!;

    expect(agentCluster.crossOriginIsolationMode).toBe('logical');
    expect(agentCluster.isOriginKeyed).toBe(true);
    expect(agentCluster.agents).toContain(agent);
  });

  it('shares a site-keyed agent between different same-site origins', () => {
    const firstOrigin = createTupleOrigin(
      'https', createHost('www.example.com'),
    );
    const secondOrigin = createTupleOrigin(
      'https', createHost('shop.example.com'),
    );
    const group = new UserAgent().createBrowsingContextGroup();

    const first = group.obtainSimilarOriginWindowAgent(firstOrigin, false);
    const second = group.obtainSimilarOriginWindowAgent(secondOrigin, false);

    expect(second).toBe(first);
  });

  it('uses structural origin equality for historical agent-cluster keys', () => {
    const firstOrigin = createTupleOrigin(
      'https', createHost('example.com'),
    );
    const equivalentOrigin = createTupleOrigin(
      'https', createHost('example.com'),
    );
    const group = new UserAgent().createBrowsingContextGroup();

    const first = group.obtainSimilarOriginWindowAgent(firstOrigin, false);
    const second = group.obtainSimilarOriginWindowAgent(equivalentOrigin, true);

    expect(second).toBe(first);
  });

  it('ignores ports for site-keyed agent clusters', () => {
    const firstOrigin = createTupleOrigin(
      'https', createHost('example.com'), 8000,
    );
    const secondOrigin = createTupleOrigin(
      'https', createHost('example.com'), 9000,
    );
    const group = new UserAgent().createBrowsingContextGroup();

    const first = group.obtainSimilarOriginWindowAgent(firstOrigin, false);
    const second = group.obtainSimilarOriginWindowAgent(secondOrigin, false);

    expect(second).toBe(first);
  });

  it('keeps equally serialized site and origin keys distinct', () => {
    const siteOrigin = createTupleOrigin(
      'https', createHost('www.example.com'),
    );
    const originKey = createTupleOrigin(
      'https', createHost('example.com'),
    );
    const group = new UserAgent().createBrowsingContextGroup();

    const siteAgent = group.obtainSimilarOriginWindowAgent(siteOrigin, false);
    const originAgent = group.obtainSimilarOriginWindowAgent(originKey, true);

    expect(originAgent).not.toBe(siteAgent);
  });
});

describe('BrowletRealm agent', () => {
  it('retains the agent in which it was created', () => {
    const agent = new WindowAgent(createManualEventLoop());
    const realm = new BrowletRealm({ agent });

    expect(realm.agent).toBe(agent);
  });

  it('queues microtasks through its agent', () => {
    const agent = new TestAgent();
    const realm = new BrowletRealm({ agent });
    const steps = vi.fn();
    const queueMicrotask = vi.spyOn(agent.eventLoop, 'queueMicrotask')
      .mockImplementation(() => {});

    realm.queueMicrotask(steps);

    expect(queueMicrotask).toHaveBeenCalledWith(steps, null);
  });

  itPassesWith('explicitQueues')(
    'shares one explicit queue between its realms and isolates other agents',
    () => {
      const firstAgent = new WindowAgent(createManualEventLoop());
      const secondAgent = new WindowAgent(createManualEventLoop());
      const firstRealm = new BrowletRealm({ agent: firstAgent });
      const secondRealm = new BrowletRealm({ agent: firstAgent });
      const isolatedRealm = new BrowletRealm({ agent: secondAgent });
      const order: string[] = [];

      for (const realm of [firstRealm, secondRealm, isolatedRealm]) {
        Reflect.set(realm.globalObject, 'record', (value: string) => {
          order.push(value);
        });
      }
      firstRealm.evaluate(
        `Promise.resolve().then(() => record('first'))`,
        'first-realm.js',
      );
      secondRealm.evaluate(
        `Promise.resolve().then(() => record('second'))`,
        'second-realm.js',
      );
      isolatedRealm.evaluate(
        `Promise.resolve().then(() => record('isolated'))`,
        'isolated-realm.js',
      );

      firstAgent.eventLoop.performMicrotaskCheckpoint();
      expect(order).toEqual(['first', 'second']);

      secondAgent.eventLoop.performMicrotaskCheckpoint();
      expect(order).toEqual(['first', 'second', 'isolated']);
    },
  );
});

class TestAgent extends Agent {
  constructor() {
    super(false, createManualEventLoop());
  }
}

function createTupleOrigin(
  scheme: string,
  host: Host,
  port: number | null = null,
): TupleOrigin {
  return {
    kind: 'tuple',
    scheme,
    host,
    port,
    domain: null,
  };
}

function createHost(value: string): Domain {
  return { kind: 'domain', value };
}
