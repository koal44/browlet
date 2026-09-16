import {
  deserializeAbortReason, type FetchTaskScheduling, type QueueGlobalFetchTask,
} from '../../fetch/index';
import type { BindingContext } from '../../web-idl/index';
import { Realm } from '../scripting/realm';
import { networkingTaskSource } from '../scripting/tasks';
import { runInParallel } from './scripting';

/** Realize Fetch's fallback error before delivering the reason into the target realm. */
export function deserializeFetchAbortReason(
  abortReason: object | null,
  context: BindingContext,
): unknown {
  return context.realizeException(
    deserializeAbortReason(abortReason, context.getRuntime()),
  );
}

export const queueGlobalFetchTask: QueueGlobalFetchTask = (global, steps) => {
  const realm = Realm.getAssociatedRealm(global);
  if (!realm) throw new Error('A Fetch task destination must have an HTML realm');
  realm.queueGlobalTask(networkingTaskSource, steps);
};

export const fetchTaskScheduling: FetchTaskScheduling = {
  queueGlobalTask: queueGlobalFetchTask,
  runInParallel,
};
