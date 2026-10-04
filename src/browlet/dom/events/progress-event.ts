import type { DOMEnvironment } from '../environment';
import type { DOMHighResTimeStamp } from '../../performance/high-resolution-time';
import {
  arg, atArg, ctor, defineDictionary, defineInterface, dictMember,
  emptyDictionary, idlType, impl, integer, roAttr, reference,
} from '../../../web-idl/index';
import { EventImpl, type EventInitRecord } from './event';
import type { EventTargetImpl } from './event-target';

/** Reports completed work and, when known, its total amount. */
// https://xhr.spec.whatwg.org/#interface-progressevent
export class ProgressEventImpl extends EventImpl {
  /** Whether total describes a known amount of work. */
  lengthComputable: boolean;
  /** Amount of work completed. */
  loaded: number;
  /** Total amount of work; meaningful when lengthComputable is true. */
  total: number;

  constructor(
    type: string,
    eventInitDict: ProgressEventInitRecord = {},
    timeStamp?: DOMHighResTimeStamp,
  ) {
    super(type, eventInitDict, timeStamp);
    this.lengthComputable = eventInitDict.lengthComputable ?? false;
    this.loaded = eventInitDict.loaded ?? 0;
    this.total = eventInitDict.total ?? 0;
  }

  /** Fire a trusted progress event at the target; a zero length leaves the total unknown. */
  // https://xhr.spec.whatwg.org/#concept-event-fire-progress
  static fire(
    name: string,
    target: EventTargetImpl,
    transmitted: number,
    length: number,
  ): boolean {
    return target.fireEvent(name, ProgressEventImpl, (event) => {
      const progress = event as ProgressEventImpl;
      progress.loaded = transmitted;
      if (length !== 0) {
        progress.lengthComputable = true;
        progress.total = length;
      }
    });
  }
}

/*
 * [Exposed=(Window,Worker)]
 * interface ProgressEvent : Event {
 *   constructor(DOMString type, optional ProgressEventInit eventInitDict = {});
 *
 *   readonly attribute boolean lengthComputable;
 *   readonly attribute double loaded;
 *   readonly attribute double total;
 * };
 */
export const progressEventIDL = defineInterface<DOMEnvironment>({
  name: 'ProgressEvent',
  inherits: 'Event',
  exposed: ['Window', 'Worker'],
  implementation: impl(ProgressEventImpl, {
    constructWith: [atArg(2, (ctx) => ctx.realm.eventTimeStamp())],
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

/*
 * dictionary ProgressEventInit : EventInit {
 *   boolean lengthComputable = false;
 *   double loaded = 0;
 *   double total = 0;
 * };
 */
export const progressEventInitIDL = defineDictionary({
  name: 'ProgressEventInit',
  inherits: 'EventInit',
  members: [
    dictMember('lengthComputable', idlType.boolean, { default: false }),
    dictMember('loaded', idlType.double, { default: integer(0) }),
    dictMember('total', idlType.double, { default: integer(0) }),
  ],
});

/** Event flags and progress measurements accepted by event creation. */
interface ProgressEventInitRecord extends EventInitRecord {
  lengthComputable?: boolean;
  loaded?: number;
  total?: number;
}
