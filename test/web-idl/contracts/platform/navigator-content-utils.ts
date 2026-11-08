import type { Navigator, WorkerNavigator } from '../../../../src/browlet/platform';

declare const navigator: Navigator;
declare const workerNavigator: WorkerNavigator;

const registration: void = navigator.registerProtocolHandler('web+test', '/handler?url=%s');
const removal: void = navigator.unregisterProtocolHandler('web+test', '/handler?url=%s');
void [registration, removal];

// @ts-expect-error Both protocol-handler arguments are required.
navigator.registerProtocolHandler('web+test');
// @ts-expect-error Both protocol-handler arguments are required.
navigator.unregisterProtocolHandler('web+test');
// @ts-expect-error Custom handler registration is Window-only.
workerNavigator.registerProtocolHandler('web+test', '/handler?url=%s');
// @ts-expect-error Custom handler removal is Window-only.
workerNavigator.unregisterProtocolHandler('web+test', '/handler?url=%s');
