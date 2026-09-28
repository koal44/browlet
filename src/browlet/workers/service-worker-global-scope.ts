import { EventTargetImpl } from '../dom/events/event-target';

// Service Workers §4.7 and DOM §2.7. This is the event-listener portion of a
// future ServiceWorkerGlobalScope host, kept abstract until Browlet implements
// service-worker registration, script resources, and worker event types.
export abstract class ServiceWorkerGlobalScopeImpl extends EventTargetImpl
{
  protected abstract scriptResourceHasEverBeenEvaluated: boolean;
  protected abstract eventTypesToHandle: ReadonlySet<string>;

  protected abstract isServiceWorkerEventType(type: string): boolean;
  protected abstract reportWarning(message: string): void;

  // -- Internal ---------------------------------------------------------

  // https://dom.spec.whatwg.org/#legacy-obtain-service-worker-fetch-event-listener-callbacks
  getFetchEventListenerCallbacks(): EventListenerOrEventListenerObject[] {
    return this.getEventListenerCallbacks('fetch');
  }

  protected override addingEventListener(type: string): void {
    if (
      this.scriptResourceHasEverBeenEvaluated &&
      this.isServiceWorkerEventType(type)
    ) {
      this.reportWarning(
        `Adding a ${type} event listener after the service worker script was evaluated might not have the expected result`,
      );
    }
  }

  protected override removingEventListener(type: string): void {
    if (this.eventTypesToHandle.has(type)) {
      this.reportWarning(
        `Removing a handled ${type} event listener might not have the expected result`,
      );
    }
  }
}
