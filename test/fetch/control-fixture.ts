import { FetchController, deserializeAbortReason } from '../../src/fetch/controller';
import type { FetchStructuredData } from '../../src/fetch/index';
import { createBindings, type BindingContext } from '../../src/web-idl/index';
import { TestRealm } from '../web-idl/test-realm';

export function createControllerFixture(
  structuredData: FetchStructuredData,
  context: BindingContext = createTestContext(),
) {
  const controller = new FetchController();
  return {
    controller,
    context,
    // Preserve the distinction between an omitted reason and explicit undefined.
    abort: (...reason: [] | [unknown]) => {
      controller.abort(context, structuredData, ...reason);
    },
    deserialize: (reason: object | null) =>
      deserializeAbortReason(reason, context, structuredData),
  };
}

function createTestContext(): BindingContext {
  const realm = new TestRealm();
  const registration = createBindings([]).register(realm);
  registration.install(realm.global);
  return registration.context;
}
