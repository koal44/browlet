import type { NetworkingTasks } from '../../js-engine/index';
import { Realm } from '../scripting/realm';
import { networkingTaskSource } from '../scripting/tasks';
import { InternalError } from '../../infra/internal-error';

export const queueGlobalFetchTask: NetworkingTasks['queueGlobalTask'] = (global, steps) => {
  const realm = Realm.getAssociatedRealm(global);
  if (!realm) throw new InternalError('A Fetch task destination must have an HTML realm');
  realm.queueGlobalTask(networkingTaskSource, steps);
};

export const fetchTaskScheduling: NetworkingTasks = {
  queueGlobalTask: queueGlobalFetchTask,
};
