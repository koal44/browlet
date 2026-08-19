import {
  EventTargetImpl, type EventTargetVirtuals,
} from '../../domlet/events/event-target';

// Service Workers §4.7 and DOM §2.7. This is the event-listener portion of a
// future ServiceWorkerGlobalScope host, kept abstract until Browlet implements
// service-worker registration, script resources, and worker event types.
export abstract class ServiceWorkerGlobalScopeImpl extends EventTargetImpl
{
  protected abstract readonly scriptResourceHasEverBeenEvaluated: boolean;
  protected abstract readonly eventTypesToHandle: ReadonlySet<string>;
  protected abstract isServiceWorkerEventType(type: string): boolean;
  protected abstract reportWarning(message: string): void;

  constructor() {
    super(ServiceWorkerGlobalScopeImpl.#eventTargetVirtuals);
  }

  // -- Virtual ----------------------------------------------------------

  static readonly #eventTargetVirtuals: EventTargetVirtuals = {
    addingEventListener: (target, type) => {
      (target as ServiceWorkerGlobalScopeImpl).#addingEventListener(type);
    },
    removingEventListener: (target, type) => {
      (target as ServiceWorkerGlobalScopeImpl).#removingEventListener(type);
    },
  };

  // -- Private ----------------------------------------------------------

  #addingEventListener(type: string): void {
    if (
      this.scriptResourceHasEverBeenEvaluated &&
      this.isServiceWorkerEventType(type)
    ) {
      this.reportWarning(
        `Adding a ${type} event listener after the service worker script was evaluated might not have the expected result`,
      );
    }
  }

  #removingEventListener(type: string): void {
    if (this.eventTypesToHandle.has(type)) {
      this.reportWarning(
        `Removing a handled ${type} event listener might not have the expected result`,
      );
    }
  }
}

// DOM section 2.8.
export function legacyObtainServiceWorkerFetchEventListenerCallbacks(
  global: ServiceWorkerGlobalScopeImpl,
): EventListenerOrEventListenerObject[] {
  return EventTargetImpl.getEventListenerCallbacks(global, 'fetch');
}
