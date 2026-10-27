import type { BrowletEnvironment } from '../../src/browlet/environment';

/** State for tests of script consumers; deliberately bypasses unfinished parsing. */
export function createScriptState(env: BrowletEnvironment) {
  return {
    env,
    parseError: null,
    errorToRethrow: null,
    fetchOptions: null,
    baseURL: null,
    record: null,
  };
}
