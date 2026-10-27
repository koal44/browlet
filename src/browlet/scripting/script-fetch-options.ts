import type { URLRecord } from '../../url/index';
import type { FetchRequest, ReferrerPolicy, RequestCredentials, RequestPriority } from '../../fetch/index';

import type { BrowletEnvironment } from '../environment';

/** Fetch state for a script and its descendants, initialized to HTML's defaults. */
// https://html.spec.whatwg.org/multipage/webappapis.html#script-fetch-options
// https://html.spec.whatwg.org/multipage/webappapis.html#default-script-fetch-options
export class ScriptFetchOptions {
  cryptographicNonce = '';
  integrityMetadata = '';
  parserMetadata: 'parser-inserted' | 'not-parser-inserted' = 'not-parser-inserted';
  credentialsMode: RequestCredentials = 'same-origin';
  referrerPolicy: ReferrerPolicy = '';
  renderBlocking = false;
  fetchPriority: RequestPriority = 'auto';

  /** Apply classic-script options, retaining credentials selected by the CORS setting. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#set-up-the-classic-script-request
  setUpClassicRequest(request: FetchRequest): void {
    request.cryptographicNonceMetadata = this.cryptographicNonce;
    request.integrityMetadata = this.integrityMetadata;
    request.parserInserted = this.parserMetadata === 'parser-inserted';
    request.referrerPolicy = this.referrerPolicy;
    request.renderBlocking = this.renderBlocking;
    request.priority = this.fetchPriority;
  }

  /** Apply module-script options, including their explicit credentials mode. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#set-up-the-module-script-request
  setUpModuleRequest(request: FetchRequest): void {
    this.setUpClassicRequest(request);
    request.credentialsMode = this.credentialsMode;
  }

  /** Copy inherited options, selecting this descendant's integrity and default priority. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#get-the-descendant-script-fetch-options
  getDescendantOptions(url: URLRecord, env: BrowletEnvironment): ScriptFetchOptions {
    const options = Object.assign(new ScriptFetchOptions(), this);
    options.integrityMetadata = env.resolveModuleIntegrityMetadata(url);
    options.fetchPriority = 'auto';
    return options;
  }
}
