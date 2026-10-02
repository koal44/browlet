import { isObject } from '../../js-engine/index';
import type { AssembledInterface } from '../assembled';
import type { ConversionContext } from '../conversion-context';
import { getPlatformRecord } from '../binding/platform-object';
import { InternalError } from '../../infra/internal-error';

/** Resolve an author platform object to the implementation of its declared interface. */
// https://webidl.spec.whatwg.org/#es-interface
export function jsToIDLInterface(value: unknown, context: ConversionContext, assembled: AssembledInterface): object {
  const record = getPlatformRecord(value);
  if (
    record?.binding.world === context.binding.world &&
    record.implements(assembled)
  ) return record.implInst;
  return context.throwTypeError(`Value does not implement ${assembled.name}`);
}

/** Retrieve or create the platform object for an implementation of the declared interface. */
export function projectInterface(value: unknown, context: ConversionContext, assembled: AssembledInterface): object {
  const object = isObject(value)
    ? context.binding.projectImplementationObject(value, assembled)
    : undefined;
  if (!object) {
    throw new InternalError(`IDL interface value ${assembled.name} is not an implementation target`);
  }
  return object;
}
