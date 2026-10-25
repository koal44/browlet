import type { StyleletEnvironment } from '../environment';

/** Owning environment shared by value parsing and processing. */
export interface ValueContext {
  env: StyleletEnvironment;
}
