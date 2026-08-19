import { EventTargetImpl } from './events/event-target';
import {
  createCustomEventImplementation, EventImpl,
  type CustomEventImplementationConstructor,
} from './events/event';

export function createDOMBindings(host: DOMRealmHost): DOMBindings {
  class Event extends EventImpl
  {
    protected override get initialTimeStamp(): DOMHighResTimeStamp {
      return host.eventTimeStamp();
    }
  }

  const CustomEvent = createCustomEventImplementation(Event);
  Object.defineProperty(CustomEvent, 'name', { value: 'CustomEvent' });

  return {
    CustomEvent,
    Event,
    EventTarget: createEventTargetBinding(),
  };
}

export type DOMBindings = {
  readonly CustomEvent: CustomEventImplementationConstructor;
  readonly Event: typeof EventImpl;
  readonly EventTarget: typeof EventTargetImpl;
};

export type DOMRealmHost = {
  eventTimeStamp(): DOMHighResTimeStamp;
};

function createEventTargetBinding(): typeof EventTargetImpl {
  // Node implementations already inherit this prototype. It remains shared
  // until the Node interfaces themselves receive realm-specific bindings.
  function EventTarget(): EventTargetImpl {
    return Reflect.construct(
      EventTargetImpl,
      [],
      new.target,
    ) as EventTargetImpl;
  }

  Object.setPrototypeOf(EventTarget, EventTargetImpl);
  Object.defineProperty(EventTarget, 'prototype', {
    value: EventTargetImpl.prototype,
  });

  return EventTarget as unknown as typeof EventTargetImpl;
}
