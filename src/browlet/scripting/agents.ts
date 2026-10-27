import { InternalError } from '../../infra/index';
import type { Origin, Site } from '../../url/index';

import type { MutationObserverImpl } from '../dom/nodes/index';
import type { HTMLSlotElementImpl } from '../dom/nodes/html/index';
import type { CustomElementRegistryImpl } from '../dom/nodes/html/custom-elements/index';
import type { WindowImpl } from '../browsing/window/index';

import type { EventLoop } from './event-loop';

// Browlet models the contexts it enters on the agent's EventLoop. V8 still owns
// actual function execution and engine-level agent state; ordinary JS calls do
// not automatically add records to Browlet's stack.
// CandidateExecution is the engine's memory-model bookkeeping, not a second
// event log to maintain here. Its association with our modeled clusters is unwired.
/** Owns the HTML execution boundary shared by one or more realms. */
// https://html.spec.whatwg.org/multipage/webappapis.html#integration-with-the-javascript-agent-formalism
export abstract class Agent {
  /** Intended blocking policy for this agent kind. */
  // PROVISIONAL: not connected to V8's AgentCanSuspend; Window Atomics.wait still succeeds.
  canBlock: boolean;
  /** Task processing and microtask checkpoints shared by the agent's realms. */
  eventLoop: EventLoop;
  /** Unique Browlet identifier, fixed for the agent's lifetime. */
  // PROVISIONAL: not V8's [[Signifier]] or the realm's native [[AgentSignifier]].
  readonly signifier: symbol;
  /** Observed runtime facts, not independently configurable engine settings. */
  readonly isLockFree1 = isLockFree1;
  readonly isLockFree2 = isLockFree2;
  // ECMAScript also defines [[IsLockFree8]], omitted by HTML's initialization list.
  readonly isLockFree8 = isLockFree8;
  readonly littleEndian = littleEndian;
  #agentCluster: AgentCluster | null = null;

  protected constructor(canBlock: boolean, eventLoop: EventLoop) {
    this.canBlock = canBlock;
    this.eventLoop = eventLoop;
    this.signifier = Symbol('Agent');
  }

  get agentCluster(): AgentCluster | null {
    return this.#agentCluster;
  }

  associateWithCluster(cluster: AgentCluster): void {
    if (this.#agentCluster !== null && this.#agentCluster !== cluster) {
      throw new InternalError('An agent cannot move between agent clusters');
    }

    this.#agentCluster = cluster;
  }

  /** Abort this agent's running script without executing author catch/finally blocks. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#abort-a-running-script
  abortRunningScript(): void {
    // Deferred for the shared Node execution thread: same-thread callers cannot
    // request a stop during a blocking loop. No independent stop channel or native
    // termination work is planned for this audit; see ROADMAP.md's killing-scripts section.
    // TODO(HTML §8.1.4.5): Interrupt ScriptEvaluation/module Evaluate and empty
    // the actual execution stack. The backend must return control to the host
    // without aborting unrelated Node work, then reconcile the modeled contexts,
    // script-entry tasks, and callback bookkeeping with HTML's cleanup.
    // Throwing below reports the missing implementation; it does not abort a script.
    throw new InternalError('Aborting a running script is not implemented (HTML §8.1.4.5)');
  }
}

/** Groups Windows that can potentially access one another. */
// https://html.spec.whatwg.org/multipage/webappapis.html#similar-origin-window-agent
export class WindowAgent extends Agent {
  /** Windows served by this agent, including multiple browsing contexts. */
  windowObjects = new Set<WindowImpl>();
  /** Next observer creation position shared by this Agent's Windows. */
  mutationObserverCounter = 0;
  /** Observers awaiting delivery or transient-registration cleanup. */
  pendingMutationObservers = new Set<MutationObserverImpl>();
  /** Slots signaled since the previous mutation notification. */
  signalSlots = new Set<HTMLSlotElementImpl>();
  /** Scoped construction selects its registry here while the custom constructor runs. */
  // https://html.spec.whatwg.org/multipage/custom-elements.html#active-custom-element-constructor-map
  // TODO(HTML): scoped construction/upgrade must install and remove these entries.
  activeCustomElementConstructorMap = new Map<object, CustomElementRegistryImpl>();
  /** Coalesce notification requests until their microtask begins delivery. */
  #mutationObserverMicrotaskQueued = false;

  constructor(eventLoop: EventLoop) {
    super(false, eventLoop);
  }

  /** Schedule one notification microtask for all of this Agent's Windows. */
  // https://dom.spec.whatwg.org/#queue-a-mutation-observer-compound-microtask
  queueMutationObserverMicrotask(): void {
    if (this.#mutationObserverMicrotaskQueued) return;
    this.#mutationObserverMicrotaskQueued = true;
    this.eventLoop.queueMicrotask(() => this.#notifyMutationObservers());
  }

  /** Deliver the pending batch, leaving reentrant signals for the next microtask. */
  // https://dom.spec.whatwg.org/#notify-mutation-observers
  #notifyMutationObservers(): void {
    this.#mutationObserverMicrotaskQueued = false;
    const observers = Array.from(this.pendingMutationObservers);
    this.pendingMutationObservers.clear();
    const slots = Array.from(this.signalSlots);
    this.signalSlots.clear();
    observers.sort((a, b) => a.creationOrder - b.creationOrder);
    for (const observer of observers) observer.notify();
    for (const slot of slots) slot.fireEvent('slotchange', undefined, (event) => { event.bubbles = true; });
  }
}

/** Execution for browser-owned work whose lifetime is independent of any page. */
export class SandboxAgent extends Agent {
  constructor(eventLoop: EventLoop) {
    super(false, eventLoop);
  }
}

/** Execution owner for one dedicated worker global. */
// PROVISIONAL: no DedicatedWorkerGlobalScope, worker settings, or independent execution yet.
export class DedicatedWorkerAgent extends Agent {
  globalScope: unknown = undefined;

  constructor(eventLoop: EventLoop) {
    super(true, eventLoop);
  }
}

/** Execution owner for one shared worker global. */
// PROVISIONAL: no SharedWorkerGlobalScope, connection manager, or independent execution yet.
export class SharedWorkerAgent extends Agent {
  globalScope: unknown = undefined;

  constructor(eventLoop: EventLoop) {
    super(true, eventLoop);
  }
}

/** Execution owner for one service worker global. */
// PROVISIONAL: the existing service-worker listener hook does not supply a global or execution lifetime.
export class ServiceWorkerAgent extends Agent {
  globalScope: unknown = undefined;

  constructor(eventLoop: EventLoop) {
    super(false, eventLoop);
  }
}

/** Execution owner for one worklet global. */
// PROVISIONAL: no WorkletGlobalScope, module evaluation, or worklet execution lifecycle yet.
export class WorkletAgent extends Agent {
  globalScope: unknown = undefined;

  constructor(eventLoop: EventLoop) {
    super(false, eventLoop);
  }
}

/** Records the shared-memory boundary used by Browlet's serialization algorithms. */
// https://html.spec.whatwg.org/multipage/webappapis.html#integration-with-the-javascript-agent-cluster-formalism
// PROVISIONAL: membership does not isolate native execution, memory, or host-injected values.
export class AgentCluster {
  /** Agents permanently associated with this cluster. */
  agents = new Set<Agent>();
  /** Defaults to none; Window clusters inherit their browsing context group's mode. */
  crossOriginIsolationMode: CrossOriginIsolationMode;
  /** Whether this cluster uses an origin key instead of a site key. */
  isOriginKeyed = false;

  constructor(crossOriginIsolationMode: CrossOriginIsolationMode = 'none') {
    this.crossOriginIsolationMode = crossOriginIsolationMode;
  }

  add(agent: Agent): void {
    agent.associateWithCluster(this);
    this.agents.add(agent);
  }
}

export type AgentClusterKey = Origin | Site;

export type CrossOriginIsolationMode = 'none' | 'logical' | 'concrete';

// All current realms use this runtime. Read its immutable facts once, without
// replacing Atomics or adding checks to author calls. Future worker runtimes
// must report their own facts and agree with their cluster before running code.
const isLockFree1 = Atomics.isLockFree(1);
const isLockFree2 = Atomics.isLockFree(2);
const isLockFree8 = Atomics.isLockFree(8);
const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
