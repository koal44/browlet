import { defineInterfaceMixin, idlType, roAttr } from '../../web-idl/core/index';

/*
 * interface mixin NavigatorConcurrentHardware {
 *   readonly attribute unsigned long long hardwareConcurrency;
 * };
 */
// https://html.spec.whatwg.org/multipage/workers.html#navigator.hardwareconcurrency
export const navigatorConcurrentHardwareIDL = defineInterfaceMixin({
  name: 'NavigatorConcurrentHardware',
  members: [roAttr('hardwareConcurrency', idlType.unsignedLongLong)],
});
