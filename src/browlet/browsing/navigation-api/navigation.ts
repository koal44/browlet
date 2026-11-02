import { InternalError } from '../../../infra/index';
import { defineInterface, impl } from '../../../web-idl/core/index';
import type { URLRecord } from '../../../url/index';
import type { FormDataEntry } from '../../../xhr/index';

import { EventTargetImpl } from '../../dom/events/index';
import type { ElementImpl } from '../../dom/nodes/index';
import type { BrowletEnvironment } from '../../environment';
import type { SerializedRecord } from '../../scripting/structured-data/index';
import type { NavigationAPIMethodTracker, UserNavigationInvolvement } from '../navigation/index';

/** Window-owned Navigation identity; entry state and navigation events remain unfinished. */
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigation-interface
export class NavigationImpl extends EventTargetImpl {
  declare env: BrowletEnvironment;

  /** Decide whether push, replace, or reload may continue after its navigate event. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#fire-a-push/replace/reload-navigate-event
  firePushReplaceReloadNavigateEvent(
    _navigationType: NavigationType, _destinationURL: URLRecord, _isSameDocument: boolean,
    _options: PushReplaceReloadNavigateEventOptions = {},
  ): boolean {
    // TODO(HTML 7.2.6): Abort previous navigation, handle disabled entries/events and tracker state,
    // create NavigateEvent/NavigationDestination, and run the inner event/cancellation algorithm.
    throw new InternalError('Navigation API navigate-event firing is not implemented');
  }
}

/** Navigation category supplied to the event algorithms. */
export type NavigationType = 'push' | 'replace' | 'reload' | 'traverse';

/**
 * Optional event inputs. Involvement defaults to 'none'; source, form data, and classic state to null;
 * Navigation API state defaults to storage-serialized null. The tracker may be omitted.
 */
export type PushReplaceReloadNavigateEventOptions = {
  userInvolvement?: UserNavigationInvolvement;
  sourceElement?: ElementImpl | null;
  formDataEntryList?: FormDataEntry[] | null;
  navigationAPIState?: SerializedRecord;
  classicHistoryAPIState?: SerializedRecord | null;
  apiMethodTracker?: NavigationAPIMethodTracker | null;
};

// TODO(HTML 7.2.6): Add Navigation's entries, state, operations, and event-handler attributes.
// This declaration provides only the nonconstructible EventTarget identity needed by its Window.
export const navigationIDL = defineInterface({
  name: 'Navigation',
  inherits: 'EventTarget',
  exposed: 'Window',
  implementation: impl(NavigationImpl),
  members: [],
});
