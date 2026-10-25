import { InternalError } from '../../infra/internal-error';
import { decode, getEncoding, type Encoding } from '../../encoding/index';
import { copyURL, type URLRecord } from '../../url/index';
import { getMIMETypeEssence } from '../../mime/index';
import {
  fetch, FetchRequest, isFilteredResponse, isOkStatus, parseReferrerPolicyFromHeader,
  type FetchController, type FetchResponse,
} from '../../fetch/index';
import {
  CSSStyleSheetImpl, getStylesheetEncoding, parseStylesheetContents, RuleListContext, type StyleSheetLoad,
} from '../../stylelet/index';

import type { DocumentImpl, ElementImpl, ProcessingInstructionImpl } from '../dom/nodes/index';

/** Fetch a CSS resource, reporting its outcome and delivering null bytes on rejection or failure. */
// https://drafts.csswg.org/cssom/#fetch-a-css-style-sheet
// SPEC_MISMATCH: fetch a CSS style sheet(parsed URL, referrer, document, request parameters, processTheResponse)
// Fetch's consume-body callback provides the bytes after EOF and observes body
// failures. Returning the controller permits the owning algorithm to stop it.
export function fetchCSSStyleSheet(
  url: URLRecord, referrer: URLRecord, document: DocumentImpl,
  parameters: Partial<FetchRequest>,
  processTheResponse: (response: FetchResponse, bytes: Uint8Array | null, outcome: StyleSheetFetchOutcome) => void,
): FetchController {
  const env = document.env;
  const request = new FetchRequest(url, env);
  request.client = env;
  request.origin = document.origin;
  request.referrer = referrer;
  request.destination = 'style';
  request.policyContainer = document.policyContainer;
  Object.assign(request, parameters);
  const controller: FetchController = fetch(request, {
    processResponseConsumeBody(response, body) {
      if (controller.state !== 'ongoing' || response.type === 'error' || body === 'failure') {
        processTheResponse(response, null, 'failure');
        return;
      }
      const internalResponse = isFilteredResponse(response) ? response.internalResponse : response;
      // SPEC_CLASH(stylesheet-http-status): Follow all three browsers; CSSOM omits the successful-status check.
      if (!isOkStatus(internalResponse.status)) {
        processTheResponse(response, null, 'http-error');
        return;
      }
      let mimeType = internalResponse.headerList.extractMIMEType();
      const supported = mimeType !== null && getMIMETypeEssence(mimeType) === 'text/css';
      if (!supported && document.compatMode !== 'CSS1Compat' && response.type !== 'opaque') {
        internalResponse.headerList.set('Content-Type', 'text/css');
        mimeType = internalResponse.headerList.extractMIMEType();
      }
      if (mimeType === null || getMIMETypeEssence(mimeType) !== 'text/css') {
        processTheResponse(response, null, 'failure');
        return;
      }
      processTheResponse(response, body ?? new Uint8Array(), 'success');
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
  const encoding = getStylesheetEncoding(bytes, {
    transportEncoding: mimeType?.parameters.get('charset'),
    environmentEncoding: options.encoding ?? getEncoding(document.encoding) ?? 'UTF-8',
  });
  const source = decode(bytes, encoding);
  const sheet = new CSSStyleSheetImpl({
    location: copyURL(url),
    baseURL: copyURL(internalResponse.url ?? url),
    encoding,
    referrerPolicy: parseReferrerPolicyFromHeader(internalResponse),
    ownerNode: options.ownerNode,
    parentStyleSheet: null,
    ownerRule: null,
    media: options.media,
    title: options.title,
    alternate: options.alternate,
    originClean: response.type !== 'opaque',
  }, env);
  // Parsing does not fetch imports. The owner explicitly starts loadStyleSheetImports()
  // and waits for its completion before reporting success or releasing blockers.
  sheet.replaceRules(parseStylesheetContents(source, new RuleListContext(sheet.ruleList, null, false, env)));
  return sheet;
}

/** Connect an explicit import load to Fetch; HTML supplies current request settings and consumes completion. */
export function loadStyleSheetImports(
  sheet: CSSStyleSheetImpl, document: DocumentImpl,
  parameters: (parent: CSSStyleSheetImpl) => Partial<FetchRequest>, complete: (success: boolean) => void,
  started?: (load: StyleSheetLoad) => void,
): StyleSheetLoad {
  return sheet.loadImports((url, rule, loaded) => {
    const parent = rule.parentStyleSheet!;
    if (parent.encoding === undefined) throw new InternalError('Import loading requires the parent stylesheet encoding');
    // https://w3c.github.io/webappsec-referrer-policy/#integration-with-css
    const referrer = parent.location === null
      ? document.url : parent.baseURL ?? parent.location;
    const requestParameters: Partial<FetchRequest> = {
      // SPEC_CLASH(stylesheet-referrer-policy): Like Firefox, use the external sheet's own default when no valid header exists.
      referrerPolicy: parent.location === null
        ? document.policyContainer.referrerPolicy : parent.referrerPolicy || 'strict-origin-when-cross-origin',
      ...parameters(parent), initiatorType: 'css',
    };
    rule.url.applyRequestModifiers(requestParameters);
    const controller = fetchCSSStyleSheet(url, referrer, document, requestParameters, (response, bytes, outcome) => {
      // Failed HTTP imports retain an empty sheet; their response CSS must not be applied.
      loaded(outcome === 'failure' ? null : createFetchedStyleSheet(url, response, bytes ?? new Uint8Array(), {
        ownerNode: null, media: '', title: '', alternate: false, encoding: parent.encoding,
      }, document), outcome === 'success');
    });
    return () => controller.terminate();
  }, complete, started);
}

/** HTTP rejection permits an empty import association; other failures do not supply a sheet. */
export type StyleSheetFetchOutcome = 'success' | 'http-error' | 'failure';

/** Association metadata captured by the initiating processing instruction or header. */
export type FetchedStyleSheetOptions = {
  ownerNode: ElementImpl | ProcessingInstructionImpl | null;
  media: string;
  title: string;
  alternate: boolean;
  encoding?: Encoding;
};
