import { InternalError } from '../../../infra/internal-error';

/** Reserved observer identity; observation and delivery await DOM mutation observers. */
// https://dom.spec.whatwg.org/#interface-mutationobserver
export class MutationObserverImpl {
  constructor() {
    throw new InternalError('MutationObserver construction is not implemented');
  }
}

/** A node's observer association, including an optional transient source. */
// https://dom.spec.whatwg.org/#registered-observer
export type RegisteredObserver = {
  observer: MutationObserverImpl;
  options: MutationObserverInitRecord;
  source?: RegisteredObserver;
};

/** Post-conversion observation options; optional flags are normalized by observe(). */
export type MutationObserverInitRecord = {
  childList: boolean;
  attributes?: boolean;
  characterData?: boolean;
  subtree: boolean;
  attributeOldValue?: boolean;
  characterDataOldValue?: boolean;
  attributeFilter?: string[];
};
