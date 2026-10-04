import type { NetworkingTasks } from '../../js-engine/index';
import { Realm } from '../scripting/realm';
import { networkingTaskSource } from '../scripting/tasks';
import { InternalError } from '../../infra/internal-error';

/** Queue Fetch delivery in the HTML realm associated with the destination global. */
export const queueGlobalFetchTask: NetworkingTasks['queueGlobalTask'] = (global, steps) => {
  const realm = Realm.getAssociatedRealm(global);
  if (!realm) throw new InternalError('A Fetch task destination must have an HTML realm');
  realm.queueGlobalTask(networkingTaskSource, steps);
};

/** HTML task delivery supplied to Fetch's shared networking-task contract. */
export const fetchTaskScheduling: NetworkingTasks = {
  queueGlobalTask: queueGlobalFetchTask,
};
