import { FetchController, deserializeAbortReason } from '../../src/fetch/controller';
import type { RealmExecution } from '../../src/js-engine/index';

export function createControllerFixture(
  exec: RealmExecution,
) {
  const controller = new FetchController();
  return {
    controller,
    exec,
    // Preserve the distinction between an omitted reason and explicit undefined.
    abort: (...reason: [] | [unknown]) => {
      if (reason.length === 0) controller.abort(exec);
      else controller.abort(reason[0], exec);
    },
    deserialize: (reason: object | null) =>
      deserializeAbortReason(reason, exec),
  };
}
