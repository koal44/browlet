import { FetchController, deserializeAbortReason } from '../../src/fetch/controller';
import type { RuntimeContext } from '../../src/js-engine/index';

export function createControllerFixture(
  runtime: RuntimeContext,
) {
  const controller = new FetchController();
  return {
    controller,
    runtime,
    // Preserve the distinction between an omitted reason and explicit undefined.
    abort: (...reason: [] | [unknown]) => {
      if (reason.length === 0) controller.abort(runtime);
      else controller.abort(reason[0], runtime);
    },
    deserialize: (reason: object | null) =>
      deserializeAbortReason(reason, runtime),
  };
}
