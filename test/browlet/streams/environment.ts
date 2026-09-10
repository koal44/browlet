import { streamsIDLDefinitions } from '../../../src/streams/index';
import {
  createBindings, defineInterface, xattr, type BindingContext,
} from '../../../src/web-idl/index';
import { createRuntime } from '../../js-engine/runtime-fixture';
import { TestRealm } from '../../web-idl/test-realm';

export function createTestContext(): BindingContext {
  const realm = new TestRealm();
  const realmBindings = createBindings(testDefinitions).register(realm, {
    createRuntime: () => createRuntime(realm),
  });
  realmBindings.projectGlobalObject(realm.global, testGlobalIDL.name);
  return realmBindings.context;
}

const testGlobalIDL = defineInterface({
  name: 'TestStreamGlobal',
  exposed: 'Window',
  ...xattr(['Global', 'Window']),
  members: [],
});

const abortSignalIDL = defineInterface({
  name: 'AbortSignal',
  exposed: '*',
  members: [],
});

const testDefinitions = [testGlobalIDL, abortSignalIDL, ...streamsIDLDefinitions];
