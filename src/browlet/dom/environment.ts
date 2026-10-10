import type { DOMHighResTimeStamp } from '../timing/index';
import type { EventImpl } from './events/index';
import type { DocumentImpl } from './nodes/index';

/** Environment supplying the realm and allocation facilities used by DOM algorithms. */
export interface DOMEnvironment {
  realm: DOMRealm;
  exec: EventExecution;
}

/** Realm facilities used by DOM constructors as well as event dispatch. */
export interface DOMRealm extends EventRealm {
  /** The global's associated document; non-Window globals have none. */
  getAssociatedDocument(): DocumentImpl | null;
}

/** Allocation facilities needed to create events for a target. */
export interface EventExecution {
  /** Create a trusted event owned by this execution's realm. */
  createEvent(eventConstructor?: EventImplConstructor): EventImpl;
}

/** Realm operations used by event timestamps and listener dispatch. */
export interface EventRealm {
  /** Creation timestamp in milliseconds relative to the realm's time origin. */
  eventTimeStamp(): DOMHighResTimeStamp;
  isWindow(): this is WindowEventRealm;
}

/** Window-specific current-event state and listener timing. */
export interface WindowEventRealm extends EventRealm {
  getCurrentEvent(): EventImpl | undefined;
  recordEventListenerTiming(event: EventImpl, callback: object): void;
  setCurrentEvent(event: EventImpl | undefined): void;
}

export type EventImplConstructor = typeof EventImpl;
