import type { NotRestoredReasons, NotRestoredReasonDetails, Window } from '../../../../src/browlet/platform';

declare const window: Window;
declare const reasons: NotRestoredReasons;

const details: readonly NotRestoredReasonDetails[] | null = reasons.reasons;
const children: readonly NotRestoredReasons[] | null = reasons.children;
const json: object = reasons.toJSON();
// @ts-expect-error NotRestoredReasons has no author constructor.
new window.NotRestoredReasons();
// @ts-expect-error NotRestoredReasonDetails has no author constructor.
new window.NotRestoredReasonDetails();
// @ts-expect-error The diagnostic arrays are frozen.
reasons.reasons?.push({ reason: 'fetch', toJSON() { return {}; } });
// @ts-expect-error Diagnostic attributes are readonly.
reasons.src = '';
void details;
void children;
void json;
