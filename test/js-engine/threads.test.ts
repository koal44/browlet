import { expectTypeOf, it } from 'vitest';

import type { InternalPromise } from '../../src/infra/promises';
import type { JSThread, JSThreadEndpoint, JSThreadExit, JSThreadProtocol, JSTransferable } from '../../src/js-engine/index';

it('types startup and opposite message directions from one thread protocol', () => {
  type ConstructorArguments = ConstructorParameters<typeof JSThread<TestProtocol>>;
  expectTypeOf<ConstructorArguments[0]>().toEqualTypeOf<TestProtocol['startup']>();
  expectTypeOf<ConstructorArguments[1]>().toEqualTypeOf<(message: TestProtocol['fromThread']) => void>();
  expectTypeOf<ConstructorArguments[2]>().toEqualTypeOf<JSTransferable[] | undefined>();
  expectTypeOf<JSThread<TestProtocol>['send']>().parameter(0).toEqualTypeOf<TestProtocol['toThread']>();
  expectTypeOf<JSThread<TestProtocol>['send']>().parameter(1).toEqualTypeOf<JSTransferable[] | undefined>();
  expectTypeOf<JSThreadEndpoint<TestProtocol>['data']>().toEqualTypeOf<TestProtocol['startup']>();
  expectTypeOf<JSThreadEndpoint<TestProtocol>['listen']>().parameter(0)
    .toEqualTypeOf<(message: TestProtocol['toThread']) => void>();
  expectTypeOf<JSThreadEndpoint<TestProtocol>['send']>().parameter(0).toEqualTypeOf<TestProtocol['fromThread']>();
  expectTypeOf<JSThreadEndpoint<TestProtocol>['send']>().parameter(1).toEqualTypeOf<JSTransferable[] | undefined>();
  expectTypeOf<JSThread<TestProtocol>['closed']>().toEqualTypeOf<InternalPromise<JSThreadExit>>();
  expectTypeOf<JSThread<TestProtocol>['terminate']>().returns.toEqualTypeOf<InternalPromise<JSThreadExit>>();
});

interface TestProtocol extends JSThreadProtocol {
  startup: { name: string; };
  toThread: { type: 'request'; value: number; };
  fromThread: { type: 'reply'; result: string; };
}
