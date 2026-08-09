import type { Document } from '../domlet/nodes/document';

export class Window {
  readonly document: Document;
  readonly location: URL;
  readonly #listeners = new Map<string, Set<WindowEventListener>>();

  constructor(document: Document, url: URL) {
    this.document = document;
    this.location = url;
  }

  readonly addEventListener = (
    type: string,
    listener: WindowEventListener,
    _options?: unknown,
  ): void => {
    let listeners = this.#listeners.get(type);

    if (!listeners) {
      listeners = new Set();
      this.#listeners.set(type, listeners);
    }

    listeners.add(listener);
  };

  readonly removeEventListener = (
    type: string,
    listener: WindowEventListener,
    _options?: unknown,
  ): void => {
    this.#listeners.get(type)?.delete(listener);
  };

  readonly dispatchEvent = (event: WindowEvent): boolean => {
    for (const listener of this.#listeners.get(event.type) ?? []) {
      if (typeof listener === 'function') {
        listener(event);
      } else {
        listener.handleEvent(event);
      }
    }

    return true;
  };

  readonly setTimeout = (
    handler: (...args: unknown[]) => void,
    timeout?: number,
    ...args: unknown[]
  ): ReturnType<typeof setTimeout> => {
    return setTimeout(handler, timeout, ...args);
  };

  readonly clearTimeout = (timeout?: ReturnType<typeof setTimeout>): void => {
    clearTimeout(timeout);
  };
}

export type WindowEvent = {
  readonly type: string;
};

export type WindowEventListener =
  | ((event: WindowEvent) => void)
  | { handleEvent(event: WindowEvent): void; };
