/** Fetch's internal destination type includes values outside the public Web IDL enum. */
export type Destination = RequestDestination | 'serviceworker' | 'webidentity';

export type RequestDestination = EmptyDestination | 'audio' | 'audioworklet' | 'document' | 'embed' |
  'font' | 'frame' | 'iframe' | 'image' | 'json' | 'manifest' | 'object' | 'paintworklet' |
  'report' | 'script' | 'sharedworker' | 'style' | 'text' | 'track' | 'video' | 'worker' | 'xslt';

/** No specific resource destination, as with fetch(), XHR, and beacons; not an unset value. */
// https://fetch.spec.whatwg.org/#concept-request-destination
export type EmptyDestination = '';

// https://fetch.spec.whatwg.org/#concept-potential-destination
export type PotentialDestination = 'fetch' | Exclude<Destination, EmptyDestination>;

/** Whether this destination is script-like. */
// https://fetch.spec.whatwg.org/#request-destination-script-like
export function isScriptLikeDestination(destination: Destination): boolean {
  return scriptLikeDestinations.has(destination);
}

/** Whether this destination makes a request a subresource request. */
// https://fetch.spec.whatwg.org/#subresource-request
export function isSubresourceDestination(destination: Destination): boolean {
  return subresourceDestinations.has(destination);
}

/** Whether this destination makes a request a non-subresource request. */
// https://fetch.spec.whatwg.org/#non-subresource-request
export function isNonSubresourceDestination(destination: Destination): boolean {
  return nonSubresourceDestinations.has(destination);
}

/** Whether this destination makes a request a navigation request. */
// https://fetch.spec.whatwg.org/#navigation-request
export function isNavigationDestination(destination: Destination): boolean {
  return navigationDestinations.has(destination);
}

/** Translate the potential destination "fetch" to the empty request destination. */
// https://fetch.spec.whatwg.org/#concept-potential-destination-translate
// UNUSED: consumer integration has not needed this destination translation yet.
export function translatePotentialDestination(destination: PotentialDestination): Destination {
  return destination === 'fetch' ? '' : destination;
}

const scriptLikeDestinations = new Set<Destination>([
  'audioworklet', 'paintworklet', 'script', 'serviceworker', 'sharedworker', 'worker',
]);
const subresourceDestinations = new Set<Destination>([
  '', 'audio', 'audioworklet', 'font', 'image', 'json', 'manifest', 'paintworklet',
  'script', 'style', 'text', 'track', 'video', 'xslt',
]);
const nonSubresourceDestinations = new Set<Destination>([
  'document', 'embed', 'frame', 'iframe', 'object', 'report', 'serviceworker', 'sharedworker', 'worker',
]);
const navigationDestinations = new Set<Destination>(['document', 'embed', 'frame', 'iframe', 'object']);
