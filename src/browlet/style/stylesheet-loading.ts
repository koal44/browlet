import { CSSStyleSheetImpl, StylesheetContext, decodeStylesheetBytes, parseStylesheetContents } from '../../stylelet/index';
import { getEncoding, type Encoding } from '../../encoding/index';
import { serializeURL, type URLRecord } from '../../url/index';
import { getMIMETypeEssence } from '../../mime/index';
import { fetch, FetchRequest, isFilteredResponse, isOkStatus, type FetchController, type FetchResponse } from '../../fetch/index';

import type { DocumentImpl, ElementImpl, ProcessingInstructionImpl } from '../dom/nodes/index';

/** Fetch a CSS resource, delivering null bytes on rejection or failure so its owner can finish loading. */
// https://drafts.csswg.org/cssom/#fetch-a-css-style-sheet
// SPEC_MISMATCH: fetch a CSS style sheet(parsed URL, referrer, document, request parameters, processTheResponse)
// Fetch's consume-body callback provides the bytes after EOF and observes body
// failures. Returning the controller permits the owning algorithm to stop it.
export function fetchCSSStyleSheet(
  url: URLRecord, referrer: URLRecord, document: DocumentImpl,
  parameters: Partial<FetchRequest>,
  processTheResponse: (response: FetchResponse, bytes: Uint8Array | null) => void,
): FetchController {
  const env = document.env;
  const request = new FetchRequest(url, env, env.userAgent);
  request.origin = document.origin;
  request.referrer = referrer;
  request.destination = 'style';
  request.policyContainer = document.policyContainer;
  Object.assign(request, parameters);
  const controller: FetchController = fetch(request, {
    processResponseConsumeBody(response, body) {
      if (controller.state !== 'ongoing' || response.type === 'error' || body === 'failure') {
        processTheResponse(response, null);
        return;
      }
      const internalResponse = isFilteredResponse(response) ? response.internalResponse : response;
      // SPEC_CLASH(stylesheet-http-status): Follow all three browsers; CSSOM omits the successful-status check.
      if (!isOkStatus(internalResponse.status)) {
        processTheResponse(response, null);
        return;
      }
      let mimeType = internalResponse.headerList.extractMIMEType();
      const supported = mimeType !== null && getMIMETypeEssence(mimeType) === 'text/css';
      if (!supported && document.compatMode === 'BackCompat' && response.type !== 'opaque') {
        internalResponse.headerList.set('Content-Type', 'text/css');
        mimeType = internalResponse.headerList.extractMIMEType();
      }
      if (mimeType === null || getMIMETypeEssence(mimeType) !== 'text/css') {
        processTheResponse(response, null);
        return;
      }
      processTheResponse(response, body ?? new Uint8Array());
    },
  }, env);
  return controller;
}

/** Decode accepted bytes and create the CSS implementation; its owner performs association. */
// https://drafts.csswg.org/cssom/#create-a-css-style-sheet
// https://drafts.csswg.org/css-syntax-3/#input-byte-stream
export function createFetchedStyleSheet(
  url: URLRecord, response: FetchResponse, bytes: Uint8Array,
  options: FetchedStyleSheetOptions, document: DocumentImpl,
): CSSStyleSheetImpl {
  const env = document.env;
  const internalResponse = isFilteredResponse(response) ? response.internalResponse : response;
  const mimeType = internalResponse.headerList.extractMIMEType();
  const source = decodeStylesheetBytes(bytes, {
    transportEncoding: mimeType?.parameters.get('charset'),
    environmentEncoding: options.encoding ?? getEncoding(document.encoding) ?? 'UTF-8',
  }, env);
  const location = new env.userAgent.URL(serializeURL(url));
  const sheet = new CSSStyleSheetImpl({
    location,
    baseURL: new env.userAgent.URL(serializeURL(internalResponse.url ?? url)),
    ownerNode: options.ownerNode,
    parentStyleSheet: null,
    ownerRule: null,
    media: options.media,
    title: options.title,
    alternate: options.alternate,
    originClean: response.type !== 'opaque',
  }, env);
  // Ordinary @import already enters an explicit unfinished rule consumer.
  // Import fetching and critical-resource completion must join this load before
  // its owner can report success or release its script/load blockers.
  sheet.replaceRules(parseStylesheetContents(source, new StylesheetContext(null, false, env)));
  return sheet;
}

/** Association metadata captured by the initiating processing instruction or header. */
export type FetchedStyleSheetOptions = {
  ownerNode: ElementImpl | ProcessingInstructionImpl | null;
  media: string;
  title: string;
  alternate: boolean;
  encoding?: Encoding;
};
