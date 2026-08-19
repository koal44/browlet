import {
  constants, createContext, runInContext, type Context,
} from 'node:vm';
import type { DOMRealmHost } from '../domlet/bindings/dom-bindings';

export class Realm implements DOMRealmHost {
  readonly exposure = 'Window';
  readonly global: RealmGlobal;
  readonly #context: Context;

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
}

export type RealmGlobal = Record<PropertyKey, unknown>;
