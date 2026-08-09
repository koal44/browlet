import {
  constants, createContext, runInContext, type Context,
} from 'node:vm';

export class Realm {
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
}

export type RealmGlobal = Record<PropertyKey, unknown>;
