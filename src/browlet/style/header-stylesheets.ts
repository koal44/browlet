import { asciiLower } from '../../infra/ascii';
import type { CSSStyleSheetImpl } from '../../stylelet/index';
import { parseLinkHeader } from '../../http/index';
import type { FetchResponse } from '../../fetch/index';

import type { DocumentImpl } from '../dom/nodes/index';

import { createFetchedStyleSheet, fetchCSSStyleSheet } from './stylesheet-loading';

/** Select the preferred stylesheet set from Default-Style fields in response order. */
// Implementation helper for CSSOM's response-header requirement.
// https://drafts.csswg.org/cssom/#the-http-default-style-header
// SPEC_CLASH(default-style-response-fields): Follow CSSOM's ordered fields; Chromium/WebKit ignore them and Firefox combines duplicates.
export function processDefaultStyleHeaders(document: DocumentImpl, response: FetchResponse): void {
  for (const [name, value] of response.headerList) {
    if (asciiLower(name) === 'default-style') document.getStyleScope().changePreferredStyleSheetSetName(value);
  }
}

/** Load CSSOM's stylesheet Link relations once, independently of HTML's preload/header phases. */
// https://drafts.csswg.org/cssom/#requirements-on-user-agents-implementing-the-http-link-header
// SPEC_CLASH(http-link-stylesheets): Follow CSSOM and Firefox; Chromium/WebKit ignore stylesheet Link headers.
export function processStyleSheetLinkHeaders(document: DocumentImpl, response: FetchResponse): void {
  // Retain header order even when requests complete in the opposite order.
  const sheets: (CSSStyleSheetImpl | null)[] = [];
  for (const [name, value] of response.headerList) {
    if (asciiLower(name) !== 'link') continue;
    for (const { href, parameters } of parseLinkHeader(value)) {
      const relations = asciiLower(parameters.get('rel') ?? '').split(/ +/);
      if (!relations.includes('stylesheet')) continue;
      // RFC 8288 §3.2 permits ignoring anchored links; they need not describe this document.
      if (parameters.has('anchor')) continue;
      const title = parameters.get('title') ?? '';
      const alternate = relations.includes('alternate');
      if (alternate && title === '') continue;
      const url = document.env.parseURL(href, document.getBaseURL()).url;
      if (url === null) continue;
      const index = sheets.length;
      sheets.push(null);
      // SPEC_GAP(http-link-quirks-mode): CSSOM leaves early-header timing open; MIME checks use the document mode at response completion.
      fetchCSSStyleSheet(url, document.url, document, { initiatorType: 'link' }, (response, bytes) => {
        if (bytes === null) return;
        const sheet = createFetchedStyleSheet(url, response, bytes, {
          ownerNode: null, title, alternate, media: parameters.get('media') ?? '',
        }, document);
        sheets[index] = sheet;
        let insertionIndex = 0;
        for (let i = 0; i < index; i++) if (sheets[i] !== null) insertionIndex++;
        document.getStyleScope().addHeaderStyleSheet(sheet, insertionIndex);
        // TODO(HTML stylesheet resources): Register the pending load before
        // fetching and release it after critical resources complete. Document's
        // addScriptBlockingStyleSheet()/removeScriptBlockingStyleSheet() hold
        // elements; header loads need ownership in that resource-lifecycle review.
        // Ordinary @import currently stops at its explicit unfinished grammar.
      });
    }
  }
}
