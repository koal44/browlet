import { InternalError } from '../../infra/index';
import { utf8Decode } from '../../encoding/index';
import { getMIMETypeEssence } from '../../mime/index';
import { fetch, FetchRequest, isOkStatus, type FetchResponse } from '../../fetch/index';

import { SpeculationRuleSet } from '../scripting/index';
import type { DocumentImpl } from '../dom/nodes/index';

/** Fetch header-selected rule sets and register successful parses with their incoming Document. */
// https://html.spec.whatwg.org/multipage/speculative-loading.html#process-the-speculation-rules-header
export function processSpeculationRulesHeader(document: DocumentImpl, response: FetchResponse): void {
  const list = response.headerList.getStructuredFieldValue('Speculation-Rules', 'list');
  if (list === null) return;
  const { env } = document;
  for (const item of list.members) {
    if (item.type !== 'item' || item.bareItem.type !== 'string') continue;
    // SPEC_CLASH(speculation-header-empty-url): Chromium/WebKit skip empty strings.
    // Follow HTML: even an empty URL resolves against the Document's current base.
    const url = env.parseURL(item.bareItem.value, document.getBaseURL());
    if (url === null) continue;

    env.runInParallel(() => {
      // HTML permits an optional delay here; ordinary task scheduling supplies our deferral.
      env.queueTask('speculation-rules', () => {
        const request = new FetchRequest(url, env);
        // SPEC_GAP(speculation-header-client): HTML omits the client assignment.
        // The incoming Document owns origin, referrer, fetch group, and task delivery.
        // TODO(HTML §7.5.11): FetchGroup.cancel() does not yet stop in-flight rule requests on abortion.
        request.client = env;
        request.destination = 'speculationrules';
        request.mode = 'cors';
        // SPEC_CLASH(speculation-header-credentials): Follow HTML/Chromium;
        // WebKit sends credentials to foreign rule-set servers as well.
        request.credentialsMode = 'same-origin';
        fetch(request, {
          processResponseConsumeBody(response, bodyBytes) {
            if (bodyBytes === null || bodyBytes === 'failure' || !isOkStatus(response.status)) return;
            const mimeType = response.headerList.extractMIMEType();
            if (mimeType === null || getMIMETypeEssence(mimeType) !== 'application/speculationrules+json') return;
            const bodyText = utf8Decode(bodyBytes);
            let ruleSet: SpeculationRuleSet;
            try {
              // SPEC_CLASH(speculation-header-redirect-base): Follow HTML/Chromium's final URL;
              // WebKit's loader supplies the originally requested URL after redirects.
              // TODO(HTML §7.6): SpeculationRuleSet.parse still owns the throwing parser dependency.
              ruleSet = SpeculationRuleSet.parse(bodyText, document, response.url!);
            } catch (error) {
              // An unfinished implementation is not an author parse error.
              if (error instanceof InternalError) throw error;
              return;
            }
            document.speculationRuleSets.push(ruleSet);
            // TODO(HTML §7.6): Candidate matching and speculative navigation remain with Document.
            document.considerSpeculativeLoads();
          },
        }, env);
      });
    });
  }
}
