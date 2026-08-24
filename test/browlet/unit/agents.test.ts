import { describe, expect, it, vi } from 'vitest';

import {
  Agent, DedicatedWorkerAgent, obtainSimilarOriginWindowAgent,
  ServiceWorkerAgent, SharedWorkerAgent, WindowAgent, WorkletAgent,
} from '../../../src/browlet/scripting/agents';
import { BrowsingContextGroup } from '../../../src/browlet/navigation/browsing-context';
import { Realm } from '../../../src/browlet/scripting/realm';
import type { Domain, Host } from '../../../src/url/host';
import type { TupleOrigin } from '../../../src/url/origin';

describe('WindowAgent', () => {
  it('contains window objects and cannot block', () => {
    const agent = new WindowAgent();

    expect(agent.canBlock).toBe(false);
    expect(agent.windowObjects).toEqual(new Set());
  });
});

describe('worker and worklet agents', () => {
  it('fixes each agent type\'s blocking policy', () => {
    expect(new DedicatedWorkerAgent().canBlock).toBe(true);
    expect(new SharedWorkerAgent().canBlock).toBe(true);
    expect(new ServiceWorkerAgent().canBlock).toBe(false);
    expect(new WorkletAgent().canBlock).toBe(false);
  });

  it('reserves each agent\'s single global scope association', () => {
    expect(new DedicatedWorkerAgent().globalScope).toBeUndefined();
    expect(new SharedWorkerAgent().globalScope).toBeUndefined();
    expect(new ServiceWorkerAgent().globalScope).toBeUndefined();
    expect(new WorkletAgent().globalScope).toBeUndefined();
  });
});

describe('Agent', () => {
  it('has a unique signifier and event loop', () => {
    const first = new WindowAgent();
    const second = new WindowAgent();

    expect(first.signifier).not.toBe(second.signifier);
    expect(first.eventLoop).not.toBe(second.eventLoop);
  });
});

describe('obtainSimilarOriginWindowAgent', () => {
  it('creates a site-keyed cluster by default', () => {
    const origin = createTupleOrigin('https', createHost('example.com'));
    const group = new BrowsingContextGroup();

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
    const group = new BrowsingContextGroup();

    const first = obtainSimilarOriginWindowAgent(origin, group, false);
    const second = obtainSimilarOriginWindowAgent(origin, group, true);

    expect(second).toBe(first);
  });

  it('creates an origin-keyed cluster when OAC is requested first', () => {
    const origin = createTupleOrigin('https', createHost('example.com'));
    const group = new BrowsingContextGroup();

    const agent = obtainSimilarOriginWindowAgent(origin, group, true);
    const agentCluster = group.agentClusterMap.get(origin)!;

    expect(agentCluster.isOriginKeyed).toBe(true);
    expect(agentCluster.agents).toContain(agent);
  });

  it('creates an origin-keyed cluster for a cross-origin-isolated group', () => {
    const origin = createTupleOrigin('https', createHost('example.com'));
    const group = new BrowsingContextGroup();
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
    const group = new BrowsingContextGroup();

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
    const group = new BrowsingContextGroup();

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
    const group = new BrowsingContextGroup();

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
    const group = new BrowsingContextGroup();

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
    const agent = new WindowAgent();
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

    expect(queueMicrotask).toHaveBeenCalledWith(steps);
  });
});

class TestAgent extends Agent {
  constructor() {
    super(false);
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
