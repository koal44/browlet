import { describe, expect, it } from 'vitest';
import {
  legacyObtainServiceWorkerFetchEventListenerCallbacks,
  ServiceWorkerGlobalScopeImpl,
} from '../../../src/browlet/workers/service-worker-global-scope';

class TestServiceWorkerGlobalScope extends ServiceWorkerGlobalScopeImpl
{
  readonly warnings: string[] = [];
  evaluated = false;
  readonly handledTypes = new Set<string>();
  readonly serviceWorkerTypes = new Set(['fetch', 'install']);

  protected get scriptResourceHasEverBeenEvaluated(): boolean {
    return this.evaluated;
  }

  protected get eventTypesToHandle(): ReadonlySet<string> {
    return this.handledTypes;
  }

  protected isServiceWorkerEventType(type: string): boolean {
    return this.serviceWorkerTypes.has(type);
  }

  protected reportWarning(message: string): void {
    this.warnings.push(message);
  }
}

describe('ServiceWorkerGlobalScopeImpl', () => {
  it('reports late service-worker event registrations', () => {
    const worker = new TestServiceWorkerGlobalScope();
    worker.evaluated = true;

    worker.addEventListener('fetch', () => {});
    worker.addEventListener('message', () => {});

    expect(worker.warnings).toEqual([
      'Adding a fetch event listener after the service worker script was evaluated might not have the expected result',
    ]);
  });

  it('reports removal of an event type the worker handles', () => {
    const worker = new TestServiceWorkerGlobalScope();
    const listener = () => {};
    worker.handledTypes.add('fetch');
    worker.addEventListener('fetch', listener);

    worker.removeEventListener('fetch', listener);

    expect(worker.warnings).toEqual([
      'Removing a handled fetch event listener might not have the expected result',
    ]);
  });

  it('obtains fetch callbacks in event listener order', () => {
    const worker = new TestServiceWorkerGlobalScope();
    const first = () => {};
    const ignored = () => {};
    const second = { handleEvent: () => {} };

    worker.addEventListener('fetch', first);
    worker.addEventListener('install', ignored);
    worker.addEventListener('fetch', second);

    expect(legacyObtainServiceWorkerFetchEventListenerCallbacks(worker))
      .toEqual([first, second]);
  });
});
