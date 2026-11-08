import { asciiLower, InternalError } from '../../../infra/index';
import type { Origin, URLRecord } from '../../../url/index';
import { translatePotentialDestination, type Destination, type ReferrerPolicy, type RequestPriority } from '../../../fetch/index';

import {
  corsSettingsAttribute, referrerPolicyAttribute, fetchPriorityAttribute, type CORSSettingsState,
} from '../../dom/nodes/html/attributes/index';
import type { PolicyContainer } from '../../browsing/policy/index';
import type { DocumentImpl } from '../../dom/nodes/index';
import type { BrowletEnvironmentBase } from '../../environment/index';

/** Link inputs retained from a response or element until its resource operation and Document commitment. */
// https://html.spec.whatwg.org/multipage/semantics.html#link-processing-options
export class LinkProcessingOptions {
  href = '';
  initiator = 'link';
  integrity = '';
  type = '';
  nonce = '';
  destination: Destination = '';
  crossorigin: CORSSettingsState = 'no-cors';
  referrerPolicy: ReferrerPolicy = '';
  /** Responsive-image selection input; Early Hints leaves the specified null default. */
  // TODO(HTML §4.8.4.3): Widen to SourceSet | null when the image-source owner exists;
  // source-set construction and image selection remain separate dependencies.
  sourceSet: null = null;
  baseURL: URLRecord;
  origin: Origin;
  policyContainer: PolicyContainer;
  document: DocumentImpl | null = null;
  onDocumentReady: ((document: DocumentImpl) => void) | null = null;
  fetchPriority: RequestPriority = 'auto';
  env: BrowletEnvironmentBase;

  constructor(baseURL: URLRecord, origin: Origin, policyContainer: PolicyContainer, env: BrowletEnvironmentBase) {
    this.baseURL = baseURL;
    this.origin = origin;
    this.policyContainer = policyContainer;
    this.env = env;
  }

  /** Interpret header attributes; a rejected preload leaves these options unchanged. */
  // https://html.spec.whatwg.org/multipage/semantics.html#apply-link-options-from-parsed-header-attributes
  applyHeaderAttributes(attributes: Map<string, string>, rel: string): boolean {
    if (rel === 'preload') {
      const as = attributes.get('as');
      if (as === undefined) return false;
      // SPEC_CLASH(link-header-as-case): HTML's string translation is case-sensitive;
      // browsers interpret header as values like enumerated element attributes. Follow browsers.
      const destination = translatePreloadDestination(asciiLower(as));
      if (destination === null) return false;
      this.destination = destination;
    }
    const crossorigin = attributes.get('crossorigin');
    if (crossorigin !== undefined) {
      // SPEC_CLASH(link-header-crossorigin): HTML recognizes only explicit keywords. Use
      // the shared empty/invalid anonymous defaults, matching final headers in all browsers
      // and Firefox Early Hints; Chromium rejects invalid Early Hints values.
      this.crossorigin = corsSettingsAttribute.getState(crossorigin)!;
    }
    const integrity = attributes.get('integrity');
    if (integrity !== undefined) this.integrity = integrity;
    const referrerPolicy = attributes.get('referrerpolicy');
    if (referrerPolicy !== undefined && referrerPolicyAttribute.isValidValue(referrerPolicy)) {
      this.referrerPolicy = referrerPolicyAttribute.getState(referrerPolicy)!;
    }
    const nonce = attributes.get('nonce');
    if (nonce !== undefined) this.nonce = nonce;
    const type = attributes.get('type');
    if (type !== undefined) this.type = type;
    const fetchPriority = attributes.get('fetchpriority');
    if (fetchPriority !== undefined && fetchPriorityAttribute.isValidValue(fetchPriority)) {
      this.fetchPriority = fetchPriorityAttribute.getState(fetchPriority)!;
    }
    return true;
  }

  /** Run the resource operation defined for this header relation; other HTML relations do nothing. */
  // https://html.spec.whatwg.org/multipage/semantics.html#process-a-link-header
  processHeader(rel: string): void {
    if (rel === 'preload') this.preload();
    else if (rel === 'preconnect') this.preconnect();
    // SPEC_CLASH(link-header-modulepreload): HTML says no effect, but browsers fetch modules
    // from final headers and Chromium/Firefox also do so from Early Hints. Keep the owner explicit.
    else if (rel === 'modulepreload') this.modulepreload();
  }

  /** Fetch a preload and make its response available to the receiving Document. */
  // https://html.spec.whatwg.org/multipage/links.html#preload
  preload(): void {
    // TODO(HTML preload): Match the type, construct the Link request with its reserved/full
    // client, Fetch it, and retain the response for the Document's preload map. Commit either
    // immediately or through onDocumentReady, including SRI failure and later consumption.
    throw new InternalError('Link preload fetching and Document commitment are not implemented');
  }

  /** Establish an unused connection for this link's partition, origin, and credentials. */
  // https://html.spec.whatwg.org/multipage/links.html#preconnect
  preconnect(): void {
    // TODO(HTML preconnect / Fetch connections): Parse/admit the URL, select partition/credentials,
    // and obtain a reusable connection through the transport's connection-pool owner.
    throw new InternalError('Link preconnect is not implemented');
  }

  /** Connect a header hint to HTML's module graph fetcher and the incoming Document's module map. */
  // https://html.spec.whatwg.org/multipage/links.html#link-type-modulepreload
  modulepreload(): void {
    // TODO: Select module type/destination and script-fetch options, connect the existing
    // fetchModulepreloadModuleScriptGraph operation, and transfer reserved-client results
    // to the incoming settings/module map. Do not borrow the departing Document's module map.
    throw new InternalError('Link modulepreload header integration is not implemented');
  }
}

/** Translate only HTML's preload destinations, including fetch to the empty destination. */
// https://html.spec.whatwg.org/multipage/links.html#translate-a-preload-destination
export function translatePreloadDestination(destination: string): Destination | null {
  switch (destination) {
    case 'fetch': case 'font': case 'image': case 'script': case 'style': case 'track':
      return translatePotentialDestination(destination);
    default: return null;
  }
}
