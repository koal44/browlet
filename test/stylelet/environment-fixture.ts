import { standardDOM, type DOMOperations } from '../../src/infra/index';
import { createAsyncExecution, nativeTimerHost } from '../../src/infra/execution';
import type { StyleletEnvironment, StyleletExecution, SystemColorPalette } from '../../src/stylelet/index';
import { createClientEnvironment } from '../fetch/client-fixture';

/** A test host with real realm execution and controlled Fetch/DOM capabilities. */
export function createStyleletTestEnvironment(options: {
  dom?: DOMOperations;
  exec?: Partial<StyleletExecution>;
  systemColors?: SystemColorPalette;
} = {}): StyleletEnvironment {
  const env = createClientEnvironment();
  return {
    ...env,
    userAgent: {
      ...env.userAgent,
      blobURLStore: { resolve: () => null },
      dom: {
        ...standardDOM,
        ...options.dom,
      },
      systemColors: options.systemColors,
    },
    // Direct implementation tests retain internal results; Browlet tests cover CSSOM projection.
    exec: { ...env.exec, ...createAsyncExecution(nativeTimerHost), ...options.exec },
    getAssociatedDocument: () => null,
  };
}

/** Shared host for tests that only parse or resolve values. */
export const styleletEnv = createStyleletTestEnvironment();
