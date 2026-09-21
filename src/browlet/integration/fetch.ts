import {
  deserializeAbortReason, fetchEnvironmentSettingsObject, requestIDL, responseIDL,
} from '../../fetch/index';
import type { NetworkingTasks } from '../../js-engine/index';
import type { BindingContext } from '../../web-idl/index';
import { Realm } from '../scripting/realm';
import { networkingTaskSource } from '../scripting/tasks';
import { InternalError } from '../../infra/internal-error';

/** Realize Fetch's fallback error before delivering the reason into the target realm. */
export function deserializeFetchAbortReason(
  abortReason: object | null,
  context: BindingContext,
): unknown {
  return context.realizeException(
    deserializeAbortReason(abortReason, context.getRuntime()),
  );
}

export const queueGlobalFetchTask: NetworkingTasks['queueGlobalTask'] = (global, steps) => {
  const realm = Realm.getAssociatedRealm(global);
  if (!realm) throw new InternalError('A Fetch task destination must have an HTML realm');
  realm.queueGlobalTask(networkingTaskSource, steps);
};

export const fetchTaskScheduling: NetworkingTasks = {
  queueGlobalTask: queueGlobalFetchTask,
};

export const fetchCapabilities = [
  fetchEnvironmentSettingsObject.for(requestIDL, getFetchSettings),
  fetchEnvironmentSettingsObject.for(responseIDL, getFetchSettings),
];

/** Supply Fetch constructors with the actual HTML settings object of their realm. */
function getFetchSettings(context: BindingContext) {
  const realm = context.realm;
  if (!(realm instanceof Realm) || realm.hostDefined === null) {
    throw new InternalError('Fetch construction requires an HTML environment settings object');
  }
  return realm.hostDefined;
}
