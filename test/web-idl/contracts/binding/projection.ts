import {
  atArg, attrFn, ctor, BindingWorld, defineCapability, defineInterface,
  idlType, impl, isStampedImplInstance, isStampedPlatformObject, op, roAttr, serializeDefinition,
  type StampedImplInstance, type StampedPlatformObject, type WebIDLRealmHost,
} from '../../../../src/web-idl/index';
import type { RuntimeContext } from '../../../../src/js-engine/runtime-context';

declare const runtime: RuntimeContext;
interface HostRealm extends WebIDLRealmHost {
  eventTimeStamp(): number;
}
declare const hostRealm: HostRealm;
declare const minimalRealm: WebIDLRealmHost;
class Example { value = 1; }

atArg(0, (ctx) => ctx.getRuntime());
attrFn((ctx) => function value() { return ctx.realm.global; });
// @ts-expect-error A default binding context has no HTML timing API.
atArg(0, (ctx) => ctx.realm.eventTimeStamp());

const definition = defineInterface<HostRealm>({
  name: 'Example',
  implementation: impl(Example, {
    constructWith: [atArg(0, (ctx) => ctx.realm.eventTimeStamp())],
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
      { invoke(ctx) { return ctx.realm.eventTimeStamp(); } },
    ),
  ],
});
serializeDefinition(definition);
const capability = defineCapability<RuntimeContext>('runtime');
const world = new BindingWorld<HostRealm>([definition], {
  capabilities: [capability.for(definition, runtime)],
});
const ctx = world.register(hostRealm, {
  createRuntime(ctx) {
    ctx.realm.eventTimeStamp();
    return runtime;
  },
});
ctx.realm.eventTimeStamp();
world.forRealm(hostRealm)?.realm.eventTimeStamp();
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
world.register(minimalRealm);
// @ts-expect-error This world's realm lookup requires the same host type as registration.
world.forRealm(minimalRealm);
// @ts-expect-error A world of arbitrary Web IDL realms cannot run HTML callbacks.
new BindingWorld<WebIDLRealmHost>([definition]);
