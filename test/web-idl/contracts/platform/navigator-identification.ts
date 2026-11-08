import type { Navigator, WorkerNavigator } from '../../../../src/browlet/platform';

declare const navigator: Navigator;
declare const workerNavigator: WorkerNavigator;

const values: string[] = [
  navigator.appCodeName, navigator.appName, navigator.appVersion, navigator.platform, navigator.product,
  navigator.productSub, navigator.userAgent, navigator.vendor, navigator.vendorSub,
  workerNavigator.appCodeName, workerNavigator.appName, workerNavigator.appVersion,
  workerNavigator.platform, workerNavigator.product, workerNavigator.userAgent,
];
void values;

// @ts-expect-error Navigator identification attributes are readonly.
navigator.userAgent = 'author value';
// @ts-expect-error WorkerNavigator identification attributes are readonly.
workerNavigator.platform = 'author value';
// @ts-expect-error Window-only attributes are absent from WorkerNavigator.
workerNavigator.vendor;
// @ts-expect-error Window-only attributes are absent from WorkerNavigator.
workerNavigator.productSub;
// @ts-expect-error Window-only attributes are absent from WorkerNavigator.
workerNavigator.vendorSub;
// @ts-expect-error The selected Chrome compatibility mode has no Gecko partial.
navigator.oscpu;
// @ts-expect-error The selected Chrome compatibility mode has no Gecko partial.
navigator.taintEnabled();
