/** Opaque dependency until the Navigation API can create and settle method trackers. */
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigation-api-method-tracker
// TODO(HTML §7.2.6): Supply the record's Navigation object, key, info, serialized state,
// committed-to entry, committed/finished promises, and pending flag with their lifecycle.
export type NavigationAPIMethodTracker = { [navigationAPIMethodTrackerBrand]: true; };

declare const navigationAPIMethodTrackerBrand: unique symbol;
