import type { RequestPriority } from '../../../../../fetch/index';

import { EnumeratedAttribute } from '../../../../html/microsyntaxes/index';

/** Relative request priority; absent and invalid values leave selection to the user agent. */
// https://html.spec.whatwg.org/multipage/urls-and-fetching.html#fetch-priority-attribute
// SPEC_CLASH(fetch-priority-case): HTML/Chromium/Firefox match ASCII case-insensitively; WebKit requires lowercase. Follow HTML.
export const fetchPriorityAttribute = new EnumeratedAttribute<RequestPriority>(
  [
    { state: 'high', keywords: ['high'] },
    { state: 'low', keywords: ['low'] },
    { state: 'auto', keywords: ['auto'] },
  ],
  { missingValueDefault: 'auto', invalidValueDefault: 'auto' },
);
