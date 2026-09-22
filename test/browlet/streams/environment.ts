import { streamsIDLDefinitions } from '../../../src/streams/index';
import {
  BindingWorld, defineInterface, xattr, type BindingContext,
} from '../../../src/web-idl/index';
import { createExecution } from '../../js-engine/execution-fixture';
import { TestRealm } from '../../web-idl/test-realm';

export function createTestContext(): BindingContext {
  const realm = new TestRealm();
  const realmBindings = new BindingWorld(testDefinitions).register(realm, () => createExecution(realm));
  realmBindings.projectGlobalObject(realm.global, testGlobalIDL.name);
  return realmBindings;
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
