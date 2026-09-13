import {
  arg, atArg, ctor, defineDictionary, defineInterface, dictMember,
  emptyDictionary, idlType, impl, integer, roAttr, reference,
} from '../../../web-idl/declaration/index';
import { EventImpl, eventTimeStamp } from './event';
import { type EventTargetImpl, fireEvent } from './event-target';

/*
 * XMLHttpRequest Standard §5 — Interface ProgressEvent
 *
 * [Exposed=(Window,Worker)]
 * interface ProgressEvent : Event {
 *   constructor(DOMString type, optional ProgressEventInit eventInitDict = {});
 *
 *   readonly attribute boolean lengthComputable;
 *   readonly attribute double loaded;
 *   readonly attribute double total;
 * };
 *
 * dictionary ProgressEventInit : EventInit {
 *   boolean lengthComputable = false;
 *   double loaded = 0;
 *   double total = 0;
 * };
 */
export class ProgressEventImpl extends EventImpl {
  #lengthComputable = false;
  #loaded = 0;
  #total = 0;

  constructor(
    type: string,
    eventInitDict: ProgressEventInitRecord = {},
    timeStamp?: DOMHighResTimeStamp,
  ) {
    super(type, eventInitDict, timeStamp);
    this.initialize(eventInitDict);
  }

  get lengthComputable(): boolean {
    return this.#lengthComputable;
  }

  get loaded(): number {
    return this.#loaded;
  }

  get total(): number {
    return this.#total;
  }

  // -- Internal methods -------------------------------------------------

  initialize(init: ProgressEventInitRecord): void {
    this.#lengthComputable = init.lengthComputable ?? false;
    this.#loaded = init.loaded ?? 0;
    this.#total = init.total ?? 0;
  }
}

/** XMLHttpRequest Standard §5.1 — Fire a progress event. */
export function fireProgressEvent(
  name: string,
  target: EventTargetImpl,
  transmitted: number,
  length: number,
): boolean {
  return fireEvent(name, target, ProgressEventImpl, (event) => {
    (event as ProgressEventImpl).initialize(
      length === 0
        ? { loaded: transmitted }
        : {
          lengthComputable: true,
          loaded: transmitted,
          total: length,
        },
    );
  });
}

// -- Web IDL ------------------------------------------------------------

export const progressEventIDL = defineInterface({
  name: 'ProgressEvent',
  inherits: 'Event',
  exposed: ['Window', 'Worker'],
  implementation: impl(ProgressEventImpl, {
    constructWith: [atArg(2, eventTimeStamp)],
  }),
  members: [
    ctor([
      arg('type', idlType.DOMString),
      arg('eventInitDict', reference('ProgressEventInit'), {
        default: emptyDictionary,
        optional: true,
      }),
    ]),
    roAttr('lengthComputable', idlType.boolean),
    roAttr('loaded', idlType.double),
    roAttr('total', idlType.double),
  ],
});

export const progressEventInitIDL = defineDictionary({
  name: 'ProgressEventInit',
  inherits: 'EventInit',
  members: [
    dictMember('lengthComputable', idlType.boolean, { default: false }),
    dictMember('loaded', idlType.double, { default: integer(0) }),
    dictMember('total', idlType.double, { default: integer(0) }),
  ],
});

type ProgressEventInitRecord = {
  bubbles?: boolean;
  cancelable?: boolean;
  composed?: boolean;
  lengthComputable?: boolean;
  loaded?: number;
  total?: number;
};
