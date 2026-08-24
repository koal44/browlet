import { EventImpl } from './event';

// UI Events defines these interfaces. DOM section 2.9 only needs their
// inheritance identity to recognize click activation events; their Web IDL
// surfaces and constructors remain a UI Events implementation prerequisite.
export abstract class UIEventImpl extends EventImpl {}

export abstract class MouseEventImpl extends UIEventImpl {
  #mouseEvent = true;

  // -- Friends ----------------------------------------------------------

  static is(value: unknown): value is MouseEventImpl {
    return EventImpl.is(value) && #mouseEvent in value;
  }
}
