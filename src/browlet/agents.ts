import { EventLoop } from './event-loop';
import type { BrowsingContextGroup } from './browsing-context';
import {
  areSameOrigin, isOrigin, obtainSite, type Site,
} from './origin';
import type { Origin } from '../url/origin';

/*
 * An agent owns the execution boundary shared by one or more realms. V8 owns
 * the ECMAScript execution contexts, [[CandidateExecution]], [[LittleEndian]],
 * and [[IsLockFree*]] state; Browlet owns the HTML host state that
 * specifications associate with the agent.
 *
 * https://html.spec.whatwg.org/multipage/webappapis.html#integration-with-the-javascript-agent-formalism
 */
export abstract class Agent {
  readonly canBlock: boolean;
  readonly eventLoop: EventLoop;
  readonly signifier: symbol;
  #agentCluster: AgentCluster | null = null;

  protected constructor(canBlock: boolean) {
    this.canBlock = canBlock;
    this.eventLoop = new EventLoop();
    this.signifier = Symbol('Agent');
  }

  get agentCluster(): AgentCluster | null {
    return this.#agentCluster;
  }

  // -- Friends ----------------------------------------------------------

  static associateWithCluster(agent: Agent, cluster: AgentCluster): void {
    if (agent.#agentCluster !== null && agent.#agentCluster !== cluster) {
      throw new Error('An agent cannot move between agent clusters');
    }

    agent.#agentCluster = cluster;
  }
}

/*
 * A similar-origin window agent contains various Window objects that can
 * potentially reach each other, either directly or through document.domain.
 */
export class WindowAgent extends Agent {
  windowObjects: unknown[] = [];

  constructor() {
    super(false);
  }
}

// Contains a single DedicatedWorkerGlobalScope once its realm is created.
export class DedicatedWorkerAgent extends Agent {
  globalScope: unknown = undefined;

  constructor() {
    super(true);
  }
}

// Contains a single SharedWorkerGlobalScope once its realm is created.
export class SharedWorkerAgent extends Agent {
  globalScope: unknown = undefined;

  constructor() {
    super(true);
  }
}

// Contains a single ServiceWorkerGlobalScope once its realm is created.
export class ServiceWorkerAgent extends Agent {
  globalScope: unknown = undefined;

  constructor() {
    super(false);
  }
}

// Contains a single WorkletGlobalScope once its realm is created.
export class WorkletAgent extends Agent {
  globalScope: unknown = undefined;

  constructor() {
    super(false);
  }
}

export function obtainSimilarOriginWindowAgent(
  origin: Origin,
  group: BrowsingContextGroup,
  requestsOAC: boolean,
): WindowAgent {
  const site = obtainSite(origin);
  let key: AgentClusterKey = site;

  if (group.crossOriginIsolationMode !== 'none') {
    key = origin;
  } else if (group.historicalAgentClusterKeyMap.has(origin)) {
    key = group.historicalAgentClusterKeyMap.get(origin)!;
  } else {
    if (requestsOAC) {
      key = origin;
    }

    group.historicalAgentClusterKeyMap.set(origin, key);
  }

  let agentCluster = group.agentClusterMap.get(key);

  if (agentCluster === undefined) {
    agentCluster = new AgentCluster(group.crossOriginIsolationMode);

    if (isOrigin(key)) {
      if (!areSameOrigin(key, origin)) {
        throw new Error('An origin agent cluster key must be the given origin');
      }

      agentCluster.isOriginKeyed = true;
    }

    agentCluster.add(new WindowAgent());
    group.agentClusterMap.set(key, agentCluster);
  }

  const [windowAgent, ...additionalWindowAgents] = [...agentCluster.agents]
    .filter((agent) => agent instanceof WindowAgent);

  if (windowAgent === undefined || additionalWindowAgents.length > 0) {
    throw new Error('An agent cluster must contain one Window agent');
  }

  return windowAgent;
}

/*
 * An agent cluster is the shared-memory boundary for one or more agents.
 *
 * https://html.spec.whatwg.org/multipage/webappapis.html#integration-with-the-javascript-agent-cluster-formalism
 */
export class AgentCluster {
  readonly agents = new Set<Agent>();
  readonly crossOriginIsolationMode: CrossOriginIsolationMode;
  isOriginKeyed = false;

  constructor(crossOriginIsolationMode: CrossOriginIsolationMode) {
    this.crossOriginIsolationMode = crossOriginIsolationMode;
  }

  add(agent: Agent): void {
    Agent.associateWithCluster(agent, this);
    this.agents.add(agent);
  }
}

export type AgentClusterKey = Origin | Site;

export type CrossOriginIsolationMode = 'none' | 'logical' | 'concrete';
