import { createManualEventLoop } from '../../support/browlet-agent';
import { describe, expect, it, vi } from 'vitest';
import { UserAgent } from '../../../src/browlet/user-agent';

import {
  Agent, DedicatedWorkerAgent, obtainSimilarOriginWindowAgent,
  ServiceWorkerAgent, SharedWorkerAgent, WindowAgent, WorkletAgent,
} from '../../../src/browlet/scripting/agents';
import { Realm } from '../../../src/browlet/scripting/realm';
import { networkingTaskSource } from '../../../src/browlet/scripting/tasks';
import type { Domain, Host } from '../../../src/url/host';
import type { TupleOrigin } from '../../../src/url/origin';
import { itPassesWith } from '../../test-runtime';

describe('WindowAgent', () => {
  it('contains window objects and cannot block', () => {
    const agent = new WindowAgent(createManualEventLoop());

    expect(agent.canBlock).toBe(false);
    expect(agent.windowObjects).toEqual(new Set());
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
});

describe('obtainSimilarOriginWindowAgent', () => {
  it('runs Window and sandbox tasks with automatic host scheduling', async () => {
    const userAgent = new UserAgent();
    const group = userAgent.createBrowsingContextGroup();
    const origin = createTupleOrigin('https', createHost('example.com'));
    const agent = obtainSimilarOriginWindowAgent(origin, group, false);

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

    const first = obtainSimilarOriginWindowAgent(origin, group, false);
    const second = obtainSimilarOriginWindowAgent(origin, group, false);
    expect(first.eventLoop).not.toBe(userAgent.sandbox.responsibleEventLoop);
    expect(second).toBe(first);
    expect(createAgent).toHaveBeenCalledOnce();
  });

  it('creates a site-keyed cluster by default', () => {
    const origin = createTupleOrigin('https', createHost('example.com'));
    const group = new UserAgent().createBrowsingContextGroup();

    const agent = obtainSimilarOriginWindowAgent(origin, group, false);
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

    const first = obtainSimilarOriginWindowAgent(origin, group, false);
    const second = obtainSimilarOriginWindowAgent(origin, group, true);

    expect(second).toBe(first);
  });

  it('creates an origin-keyed cluster when OAC is requested first', () => {
    const origin = createTupleOrigin('https', createHost('example.com'));
    const group = new UserAgent().createBrowsingContextGroup();

    const agent = obtainSimilarOriginWindowAgent(origin, group, true);
    const agentCluster = group.agentClusterMap.get(origin)!;

    expect(agentCluster.isOriginKeyed).toBe(true);
    expect(agentCluster.agents).toContain(agent);
  });

  it('creates an origin-keyed cluster for a cross-origin-isolated group', () => {
    const origin = createTupleOrigin('https', createHost('example.com'));
    const group = new UserAgent().createBrowsingContextGroup();
    group.crossOriginIsolationMode = 'logical';

    const agent = obtainSimilarOriginWindowAgent(origin, group, false);
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

    const first = obtainSimilarOriginWindowAgent(firstOrigin, group, false);
    const second = obtainSimilarOriginWindowAgent(secondOrigin, group, false);

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

    const first = obtainSimilarOriginWindowAgent(firstOrigin, group, false);
    const second = obtainSimilarOriginWindowAgent(
      equivalentOrigin,
      group,
      true,
    );

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

    const first = obtainSimilarOriginWindowAgent(firstOrigin, group, false);
    const second = obtainSimilarOriginWindowAgent(secondOrigin, group, false);

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

    const siteAgent = obtainSimilarOriginWindowAgent(
      siteOrigin,
      group,
      false,
    );
    const originAgent = obtainSimilarOriginWindowAgent(
      originKey,
      group,
      true,
    );

    expect(originAgent).not.toBe(siteAgent);
  });
});

describe('Realm agent', () => {
  it('retains the agent in which it was created', () => {
    const agent = new WindowAgent(createManualEventLoop());
    const realm = new Realm({ agent });

    expect(realm.agent).toBe(agent);
  });

  it('queues microtasks through its agent', () => {
    const agent = new TestAgent();
    const realm = new Realm({ agent });
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
      const firstRealm = new Realm({ agent: firstAgent });
      const secondRealm = new Realm({ agent: firstAgent });
      const isolatedRealm = new Realm({ agent: secondAgent });
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
