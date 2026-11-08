import type { Navigator, WorkerNavigator } from '../../../../src/browlet/platform';

declare const navigator: Navigator;
declare const workerNavigator: WorkerNavigator;

const online: boolean = navigator.onLine;
const workerOnline: boolean = workerNavigator.onLine;
void [online, workerOnline];

// @ts-expect-error Navigator connectivity is readonly.
navigator.onLine = false;
// @ts-expect-error WorkerNavigator connectivity is readonly.
workerNavigator.onLine = true;
