import type {
  AgentCluster, AgentClusterKey, CrossOriginIsolationMode,
} from './agents';
import { serializeSite } from './origin';
import type { UserAgent } from './user-agent';
import type {
  WindowProxyController, WindowProxyValue,
} from './window-proxy';
import type { WindowImpl } from './window';
import type { DomletDocument } from '../domlet/nodes/document';
import { serializeOrigin, type Origin } from '../url/origin';
import type { URLRecord } from '../url/url';

/*
 * A browsing context is a programmatic representation of a series of
 * documents. HTML section 7.3.2 supplies its remaining state and lifecycle.
 */
export class BrowsingContext {
  readonly windowProxy: WindowProxyValue;
  openerBrowsingContext: BrowsingContext | null = null;
  openerOriginAtCreation: Origin | null = null;
  isPopup = false;
  isAuxiliary = false;
  initialURL: URLRecord | null = null;
  virtualBrowsingContextGroupID = 0;
  #group: BrowsingContextGroup | null = null;
  readonly #windowProxyController: WindowProxyController;

  constructor(windowProxy: WindowProxyController) {
    this.#windowProxyController = windowProxy;
    this.windowProxy = windowProxy.value;
  }

  get group(): BrowsingContextGroup | null {
    return this.#group;
  }

  get activeWindow(): WindowImpl | null {
    return this.#windowProxyController.window;
  }

  get activeDocument(): DomletDocument | null {
    return this.activeWindow?.document ?? null;
  }

  // -- Friends ----------------------------------------------------------

  static setGroup(
    browsingContext: BrowsingContext,
    group: BrowsingContextGroup | null,
  ): void {
    browsingContext.#group = group;
  }
}

/*
 * A browsing context group owns its top-level browsing contexts and the
 * allocation state for their agent clusters.
 */
export class BrowsingContextGroup {
  readonly browsingContextSet = new Set<BrowsingContext>();
  readonly agentClusterMap = new AgentClusterMap();
  readonly historicalAgentClusterKeyMap = new HistoricalAgentClusterKeyMap();
  crossOriginIsolationMode: CrossOriginIsolationMode = 'none';
  readonly #userAgent: UserAgent | null;

  constructor(userAgent: UserAgent | null = null) {
    this.#userAgent = userAgent;
  }

  append(browsingContext: BrowsingContext): void {
    if (
      browsingContext.group !== null &&
      browsingContext.group !== this
    ) {
      throw new Error('A browsing context cannot belong to two groups');
    }

    this.browsingContextSet.add(browsingContext);
    BrowsingContext.setGroup(browsingContext, this);
  }

  remove(browsingContext: BrowsingContext): void {
    if (browsingContext.group !== this) {
      throw new Error('The browsing context is not in this group');
    }

    BrowsingContext.setGroup(browsingContext, null);
    this.browsingContextSet.delete(browsingContext);

    if (this.browsingContextSet.size === 0) {
      this.#userAgent?.removeBrowsingContextGroup(this);
    }
  }
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
