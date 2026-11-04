import { atArg, attr, defineInterface, idlType, impl, tsType } from '../../../../web-idl/core/index';

import { EventImpl } from '../../../dom/events/index';
import type { DOMEnvironment } from '../../../dom/environment';

/** Legacy unload-prompt request, independent of Event's cancellation flag. */
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-beforeunloadevent-interface
// Document.fireBeforeUnload owns trusted lifecycle dispatch; event-handler return conversion lives in §8.1.8.
export class BeforeUnloadEventImpl extends EventImpl {
  /** Last assigned string; nonempty values request an unload prompt from the lifecycle producer. */
  returnValue = '';

  override isBeforeUnloadEvent(): this is BeforeUnloadEventImpl {
    return true;
  }
}

/*
 * [Exposed=Window]
 * interface BeforeUnloadEvent : Event {
 *   attribute DOMString returnValue;
 * };
 */
export const beforeUnloadEventIDL = defineInterface<DOMEnvironment>({
  name: 'BeforeUnloadEvent', inherits: 'Event', exposed: 'Window',
  implementation: impl(BeforeUnloadEventImpl, {
    constructWith: [atArg(2, (env) => env.realm.eventTimeStamp())],
  }),
  // Match lib.dom.d.ts's one-property accommodation for Event's incompatible boolean returnValue.
  members: [attr('returnValue', tsType(idlType.DOMString, 'any'))],
});
