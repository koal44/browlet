import type { EventImpl } from './events/event';

/** Environment supplying the realm and allocation facilities used by DOM events. */
export interface DOMEnvironment {
  realm: EventRealm;
  exec: EventExecution;
}

/** Allocation facilities needed to create events for a target. */
export interface EventExecution {
  /** Create a trusted event owned by this execution's realm. */
  createEvent(eventConstructor?: EventImplConstructor): EventImpl;
}

/** Realm operations used by event timestamps and listener dispatch. */
export interface EventRealm {
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
