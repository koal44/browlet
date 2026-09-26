import { FetchController, deserializeAbortReason } from '../../src/fetch/controller';
import type { JSEnvironment } from '../../src/js-engine/index';

export function createControllerFixture(
  env: JSEnvironment,
) {
  const controller = new FetchController();
  return {
    controller,
    env,
    // Preserve the distinction between an omitted reason and explicit undefined.
    abort: (...reason: [] | [unknown]) => {
      if (reason.length === 0) controller.abort(env);
      else controller.abort(reason[0], env);
    },
    deserialize: (reason: object | null) =>
      deserializeAbortReason(reason, env),
  };
}
