import { ImportMap, mergeExistingAndNewImportMaps, type BrowletGlobalObject, type SpecifierResolutionRecord } from '../scripting/index';
import { EventTargetImpl, type EventListenerValue } from '../dom/events/index';

// Registration, script resources, and worker event types await the worker host.
/** Applies service-worker listener rules before a complete worker global is available. */
// https://w3c.github.io/ServiceWorker/#serviceworkerglobalscope
export abstract class ServiceWorkerGlobalScopeImpl extends EventTargetImpl implements BrowletGlobalObject
{
  // HTML §8.1.3.3. Move these initializers to WorkerGlobalScopeImpl when that base exists.
  inErrorReportingMode = false;
  outstandingRejectedPromises = new WeakSet<Promise<unknown>>();
  aboutToBeNotifiedRejectedPromises: Promise<unknown>[] = [];
  importMap = new ImportMap();
  resolvedModuleSet = new Set<SpecifierResolutionRecord>();
  /** Whether the worker's script has completed its initial evaluation. */
  protected abstract scriptResourceHasEverBeenEvaluated: boolean;
  /** Event types recorded as handled by this service worker. */
  protected abstract eventTypesToHandle: ReadonlySet<string>;

  /** Shared global contract; HTML currently registers author import maps only in Windows. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#merge-existing-and-new-import-maps
  mergeImportMap(newImportMap: ImportMap): void {
    mergeExistingAndNewImportMaps(this, newImportMap);
  }

  // https://dom.spec.whatwg.org/#legacy-obtain-service-worker-fetch-event-listener-callbacks
  getFetchEventListenerCallbacks(): EventListenerValue[] {
    return this.getEventListenerCallbacks('fetch');
  }

  protected abstract isServiceWorkerEventType(type: string): boolean;
  protected abstract reportWarning(message: string): void;

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
