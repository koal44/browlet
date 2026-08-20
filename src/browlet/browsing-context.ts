import type {
  AgentCluster, AgentClusterKey, CrossOriginIsolationMode,
} from './agents';
import type { Origin } from '../url/origin';

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
  readonly agentClusterMap = new WeakMap<AgentClusterKey, AgentCluster>();
  readonly historicalAgentClusterKeyMap = new Map<Origin, AgentClusterKey>();
  crossOriginIsolationMode: CrossOriginIsolationMode = 'none';
}
