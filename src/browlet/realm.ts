import {
  constants, createContext, runInContext, type Context,
} from 'node:vm';
import type { DOMRealmHost } from '../domlet/bindings/dom-bindings';
import { WindowImpl } from './window';

export class Realm implements DOMRealmHost {
  readonly exposure = 'Window';
  readonly global: RealmGlobal;
  readonly #context: Context;
  #window: WindowImpl | undefined;

  constructor() {
    this.#context = createContext(constants.DONT_CONTEXTIFY);
    this.global = runInContext('this', this.#context) as RealmGlobal;
  }

  evaluate(source: string, filename: string, lineOffset = 0): unknown {
    return runInContext(source, this.#context, {
      displayErrors: false,
      filename,
      lineOffset,
    });
  }

  eventTimeStamp(): DOMHighResTimeStamp {
    // TODO(High Resolution Time): Apply the realm's time origin and coarse
    // resolution rather than borrowing the surrounding Node.js realm.
    return performance.now();
  }

  setWindow(window: WindowImpl): void {
    this.#window = window;
  }

  isWindow(global: object): boolean {
    return global === this.global;
  }

  getCurrentEvent(_global: object): Event | undefined {
    return this.#window
      ? WindowImpl.getCurrentEvent(this.#window)
      : undefined;
  }

  setCurrentEvent(_global: object, event: Event | undefined): void {
    if (this.#window) WindowImpl.setCurrentEvent(this.#window, event);
  }

  recordTimingInfo(
    _global: object,
    _event: Event,
    _callback: EventListenerOrEventListenerObject,
  ): void {
    // TODO(Long Animation Frames section 3.2.2): Record event-listener timing
    // once Browlet has the HTML performance timeline machinery.
  }

  reportException(exception: unknown, _global: object): void {
    // TODO(HTML section 8.1.5): Report through the realm's error-reporting
    // machinery once Browlet implements it.
    console.error(exception);
  }
}

export type RealmGlobal = Record<PropertyKey, unknown>;
