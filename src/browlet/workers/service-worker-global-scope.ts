import { EventTargetImpl } from '../dom/events/event-target';

// Registration, script resources, and worker event types await the worker host.
/** Applies service-worker listener rules before a complete worker global is available. */
// https://w3c.github.io/ServiceWorker/#serviceworkerglobalscope
export abstract class ServiceWorkerGlobalScopeImpl extends EventTargetImpl
{
  /** Whether the worker's script has completed its initial evaluation. */
  protected abstract scriptResourceHasEverBeenEvaluated: boolean;
  /** Event types recorded as handled by this service worker. */
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
