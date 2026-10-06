import { streamsIDLDefinitions } from '../../../src/streams/index';
import {
  BindingWorld, defineInterface, xattr, type BindingContext,
} from '../../../src/web-idl/index';
import { createEnvironment, type TestEnvironment } from '../../js-engine/execution-fixture';
import { TestRealm } from '../../support/web-idl-realm';

export function createTestContext(): BindingContext<TestEnvironment> {
  const realm = new TestRealm();
  const realmBindings = new BindingWorld<TestEnvironment>(testDefinitions).register(realm, (ctx) => createEnvironment(realm, ctx));
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
