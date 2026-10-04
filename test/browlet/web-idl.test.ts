import { expect, it } from 'vitest';

import { webIDLCommonDefinitions } from '../../src/web-idl/core/index';
import { validateDefinitions } from '../../src/web-idl/assembly/index';
import { browletDefinitions } from '../../src/browlet/bindings';
import type { BrowletEnvironment } from '../../src/browlet/scripting/environment';

it('validates the complete Web IDL declaration set used by Browlet', () => {
  expect(() => validateDefinitions<BrowletEnvironment>([
    ...webIDLCommonDefinitions, ...browletDefinitions,
  ])).not.toThrow();
});
