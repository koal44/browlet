import type { Definition } from '../web-idl/core/index';

import { urlIDL, urlSearchParamsIDL } from './api';

/** URL and URLSearchParams declarations supplied to the host binding. */
export const urlIDLDefinitions: Definition[] = [
  urlIDL,
  urlSearchParamsIDL,
];
