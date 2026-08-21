import type {
  AgentCluster, AgentClusterKey, CrossOriginIsolationMode,
} from './agents';
import { serializeSite } from './origin';
import { serializeOrigin, type Origin } from '../url/origin';

/*
 * A browsing context is a programmatic representation of a series of
 * documents. HTML section 7.3.2 supplies its remaining state and lifecycle.
 */
export class BrowsingContext {}

/*
 * A browsing context group owns its top-level browsing contexts and the
 * allocation state for their agent clusters.
 */
export class BrowsingContextGroup {
  readonly browsingContextSet = new Set<BrowsingContext>();
  readonly agentClusterMap = new AgentClusterMap();
  readonly historicalAgentClusterKeyMap = new HistoricalAgentClusterKeyMap();
  crossOriginIsolationMode: CrossOriginIsolationMode = 'none';
}

class AgentClusterMap {
  /*
   * HTML defines this as a weak map. JavaScript WeakMap cannot combine weak
   * keys with value equality, so this retains clusters for the lifetime of the
   * browsing context group until Browlet implements cluster collection.
   */
  readonly #values = new Map<string | symbol, AgentCluster>();

  get(key: AgentClusterKey): AgentCluster | undefined {
    return this.#values.get(obtainAgentClusterMapKey(key));
  }

  set(key: AgentClusterKey, value: AgentCluster): void {
    this.#values.set(obtainAgentClusterMapKey(key), value);
  }
}

class HistoricalAgentClusterKeyMap {
  readonly #values = new Map<string | symbol, AgentClusterKey>();

  get(origin: Origin): AgentClusterKey | undefined {
    return this.#values.get(obtainOriginMapKey(origin));
  }

  has(origin: Origin): boolean {
    return this.#values.has(obtainOriginMapKey(origin));
  }

  set(origin: Origin, key: AgentClusterKey): void {
    this.#values.set(obtainOriginMapKey(origin), key);
  }
}

function obtainAgentClusterMapKey(key: AgentClusterKey): string | symbol {
  if (Array.isArray(key)) return `site:${serializeSite(key)}`;
  if (key.kind === 'opaque') return key.identity;
  return `origin:${serializeOrigin(key)}`;
}

function obtainOriginMapKey(origin: Origin): string | symbol {
  return origin.kind === 'opaque'
    ? origin.identity
    : serializeOrigin(origin);
}
