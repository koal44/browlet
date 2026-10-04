import type { BindingContext } from '../../../../src/web-idl/index';

declare const context: BindingContext;
const installed: void = context.install({});
void installed;
// @ts-expect-error Public consumers cannot access assembly indexes.
context.assembly;
// @ts-expect-error Public consumers cannot request internal type converters.
context.getConverter;
// @ts-expect-error Internal allocation takes an assembled interface and is not a public operation.
context.allocatePlatformRecord;
// @ts-expect-error Internal projection accepts an assembled interface and returns its binding record.
context.projectGlobalRecord;
// @ts-expect-error Internal installation exposes bookkeeping outside the public contract.
context.installDefinitions;
