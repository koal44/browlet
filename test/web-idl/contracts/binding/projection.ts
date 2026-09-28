import {
  atArg, attrFn, ctor, BindingWorld, defineCallbackInterface, defineCapability, defineInterface,
  idlType, impl, isStampedImplInstance, isStampedPlatformObject, op, roAttr, serializeDefinition,
  type BindingContext, type Definition, type StampedImplInstance, type StampedPlatformObject,
  type WebIDLEnvironment, type WebIDLRealm,
} from '../../../../src/web-idl/index';
import type { JSEnvironment } from '../../../../src/js-engine/environment';
import type { RealmExecution } from '../../../../src/js-engine/index';

interface HostRealm extends WebIDLRealm {
  eventTimeStamp(): number;
}
interface HostExecution extends RealmExecution {
  createEvent(): object;
}
interface HostEnvironment extends WebIDLEnvironment, JSEnvironment {
  realm: HostRealm;
  exec: HostExecution;
}
declare const env: HostEnvironment;
declare const hostRealm: HostRealm;
declare const minimalRealm: WebIDLRealm;
class Example { value = 1; }

atArg(0, (ctx) => ctx.getEnvironment());
attrFn((ctx) => function value() { return ctx.realm.global; });
// @ts-expect-error A default binding context has no HTML timing API.
atArg(0, (ctx) => ctx.realm.eventTimeStamp());

const definition = defineInterface<HostEnvironment>({
  name: 'Example',
  implementation: impl(Example, {
    constructWith: [atArg(0, (ctx) => ctx.realm.eventTimeStamp())],
    initializeImplementation(ctx, value) {
      ctx.getEnvironment().exec.createEvent();
      value.value = ctx.realm.eventTimeStamp();
      // @ts-expect-error Initializers receive the implementation's fields, not arbitrary properties.
      value.missing;
      // @ts-expect-error The implementation's field types remain checked.
      value.value = 'not a number';
    },
  }),
  members: [
    ctor(
      [],
      { constructWith: [atArg(0, (ctx) => ctx.realm.eventTimeStamp())] },
    ),
    roAttr('time', idlType.double, {
      get(ctx) { return ctx.realm.eventTimeStamp(); },
    }),
    op('read', idlType.double,
      [],
      {
        invoke(ctx) {
          ctx.getEnvironment().exec.createEvent();
          return ctx.realm.eventTimeStamp();
        },
      },
    ),
  ],
});
serializeDefinition(definition);
impl(Example, {
  // @ts-expect-error The constructor determines the instance type accepted by its initializer.
  initializeImplementation(_ctx, _value: { missing: string; }) {},
});
const callbackDefinition = defineCallbackInterface<HostEnvironment>({
  name: 'Callback',
  members: [],
  adapt(_ctx, callback) {
    callback.realm.eventTimeStamp();
    return callback.object;
  },
});
const capability = defineCapability<JSEnvironment>('environment');
const world = new BindingWorld<HostEnvironment>([definition, callbackDefinition], {
  capabilities: [capability.for(definition, env)],
});
const ctx = world.register(hostRealm, (context) => {
  context.realm.eventTimeStamp();
  return env;
});
ctx.realm.eventTimeStamp();
world.forRealm(hostRealm)?.realm.eventTimeStamp();
world.forRealm(hostRealm)?.getEnvironment().exec.createEvent();
world.register(env);
ctx.getCapability(definition, capability);
ctx.createPlatformRecord(definition);
ctx.isInterfaceExposed(definition);
const implInst: StampedImplInstance<Example> = ctx.construct(Example);
implInst.value.toFixed();
const platformObject: StampedPlatformObject = ctx.project(Example, implInst);
const projected: StampedPlatformObject | undefined = world.project(implInst);
const created: StampedPlatformObject | undefined = ctx.createPlatformRecord(definition).platformObject;
const unwrapped: StampedImplInstance<Example> | undefined = ctx.unwrap(platformObject, Example);
unwrapped?.value.toFixed();
const plain = new Example();
// @ts-expect-error An ordinary instance has no stamped platform record.
const unstamped: StampedImplInstance<Example> = plain;
// @ts-expect-error An implementation stamp is not a platform stamp.
const notPlatform: StampedPlatformObject = implInst;
// @ts-expect-error A platform stamp does not expose its implementation's stamp.
const notImpl: StampedImplInstance = platformObject;
if (isStampedImplInstance(plain)) {
  const recognized: StampedImplInstance<Example> = plain;
  recognized.value.toFixed();
}
if (isStampedPlatformObject(plain)) {
  const recognized: StampedPlatformObject<Example> = plain;
  recognized.value.toFixed();
}
// @ts-expect-error HTML callbacks cannot be installed on the minimal host.
world.register({ ...env, realm: minimalRealm });
// @ts-expect-error This world's realm lookup requires the same host type as registration.
world.forRealm(minimalRealm);
// @ts-expect-error A world of arbitrary Web IDL realms cannot run HTML callbacks.
new BindingWorld<WebIDLEnvironment>([definition]);
// @ts-expect-error This callback adapter also requires the declared host realm.
new BindingWorld<WebIDLEnvironment>([callbackDefinition]);

// @ts-expect-error A realm alone does not supply the required execution facilities.
world.register({ realm: hostRealm });
// @ts-expect-error Composition must return the declared environment.
world.register(hostRealm, (context) => ({ realm: context.realm }));
// @ts-expect-error Definition collections cannot erase the environment requirement.
const erased: Definition[] = [definition];
// @ts-expect-error Widening a world must not permit registrations its callbacks cannot use.
const weakened: BindingWorld<WebIDLEnvironment> = world;

const minimal = new BindingWorld([]).register({ realm: minimalRealm });
minimal.getEnvironment().realm.global;
// @ts-expect-error A realm-only environment has no execution contract.
minimal.getEnvironment().exec;
const portable: BindingContext = ctx;
portable.getEnvironment().realm.global;
// @ts-expect-error The getter does not allow callers to assert a different environment.
portable.getEnvironment<HostEnvironment>();
