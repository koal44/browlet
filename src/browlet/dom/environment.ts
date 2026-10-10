import type { DOMHighResTimeStamp } from '../timing/index';
import type { EventImpl } from './events/index';
import type { DocumentImpl, MutationObserverImpl } from './nodes/index';
import type { HTMLSlotElementImpl } from './nodes/html/index';

/** Environment supplying the realm and allocation facilities used by DOM algorithms. */
export interface DOMEnvironment {
  /** Realm owning this environment's DOM objects. */
  realm: DOMRealm;
  /** Realm-owned allocation facilities used by DOM algorithms. */
  exec: DOMExecution;
}

/** Realm facilities used by DOM constructors as well as event dispatch. */
export interface DOMRealm {
  /** Narrow to the current-event and notification facilities of a Window realm. */
  isWindow(): this is WindowDOMRealm;
  /** Timestamp in milliseconds supplied to events created in this realm. */
  eventTimeStamp(): DOMHighResTimeStamp;
  /** The global's associated document; non-Window globals have none. */
  getAssociatedDocument(): DocumentImpl | null;
}

/** Allocation facilities supplied to DOM implementations by their owning environment. */
export interface DOMExecution {
  /** Create a trusted event owned by this execution's realm. */
  createEvent(eventConstructor?: EventImplConstructor): EventImpl;
}

/** Window-specific DOM facilities, available after isWindow() succeeds. */
export interface WindowDOMRealm extends DOMRealm {
  /** Notification owner shared by this Window and other Windows in its Agent. */
  agent: WindowDOMAgent;
  /** Legacy Window.event value saved before invoking an event listener. */
  getCurrentEvent(): EventImpl | undefined;
  /** Set or restore the legacy Window.event value during listener invocation. */
  setCurrentEvent(event: EventImpl | undefined): void;
  /** Record the listener invocation for this Window's performance reporting. */
  recordEventListenerTiming(event: EventImpl, callback: object): void;
}

/** The existing Window Agent, viewed through the DOM work it owns. */
export interface WindowDOMAgent {
  /** Next observer creation position within this Agent. */
  mutationObserverCounter: number;
  /** Observers awaiting records delivery or detached-subtree cleanup. */
  pendingMutationObservers: Set<MutationObserverImpl>;
  /** Slots awaiting change events after observer callbacks. */
  signalSlots: Set<HTMLSlotElementImpl>;
  /** Schedule one shared notification through the Agent's microtask queue. */
  queueMutationObserverMicrotask(): void;
}

/** Event implementation class accepted by the realm's event allocator. */
export type EventImplConstructor = typeof EventImpl;
