import type { FetchRequest } from '../../../../fetch/index';

/** Select the directive governing a request's intended use, before policy fallback. */
// https://w3c.github.io/webappsec-csp/#effective-directive-for-a-request
export function getEffectiveDirective(request: FetchRequest): CSPFetchDirective | null {
  if (request.initiator === 'prefetch' || request.initiator === 'prerender') return 'default-src';
  switch (request.destination) {
    case 'manifest': return 'manifest-src';
    case 'object': case 'embed': return 'object-src';
    case 'frame': case 'iframe': return 'frame-src';
    case 'audio': case 'track': case 'video': return 'media-src';
    case 'font': return 'font-src';
    case 'image': return 'img-src';
    case 'style': return 'style-src-elem';
    case 'script': case 'xslt': case 'audioworklet': case 'paintworklet': return 'script-src-elem';
    case 'serviceworker': case 'sharedworker': case 'worker': return 'worker-src';
    case 'report': return null;
    default: return 'connect-src';
  }
}

/** Fallback names in priority order; a present empty directive still stops fallback. */
// https://w3c.github.io/webappsec-csp/#directive-fallback-list
export function getDirectiveFallbackList(name: CSPFetchDirective): CSPFetchDirective[] {
  switch (name) {
    case 'script-src-elem': return ['script-src-elem', 'script-src', 'default-src'];
    case 'style-src-elem': return ['style-src-elem', 'style-src', 'default-src'];
    case 'worker-src': return ['worker-src', 'child-src', 'script-src', 'default-src'];
    case 'frame-src': return ['frame-src', 'child-src', 'default-src'];
    case 'connect-src': case 'manifest-src': case 'object-src':
    case 'media-src': case 'font-src': case 'img-src': return [name, 'default-src'];
    default: return [];
  }
}

/** Fetch source directives; inline-only directives do not govern external requests. */
export type CSPFetchDirective = 'default-src' | 'child-src' | 'connect-src' | 'font-src' | 'frame-src' |
  'img-src' | 'manifest-src' | 'media-src' | 'object-src' | 'script-src' | 'script-src-elem' |
  'style-src' | 'style-src-elem' | 'worker-src';
