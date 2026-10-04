import { EventImpl } from './event';

// UI Events defines these interfaces. DOM section 2.9 only needs their
// inheritance identity to recognize click activation events; their Web IDL
// surfaces and constructors remain a UI Events implementation prerequisite.
/** Base identity for UI event implementations used during event dispatch. */
export abstract class UIEventImpl extends EventImpl {}

/** Mouse-event identity used to recognize click activation events. */
export abstract class MouseEventImpl extends UIEventImpl {
  #mouseEvent = true;

  static is(value: unknown): value is MouseEventImpl {
    return EventImpl.is(value) && #mouseEvent in value;
  }
}
