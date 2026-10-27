import { InternalError } from '../../../infra/index';
import { areSameOrigin, copyURL, serializeURL, type Origin, type URLRecord } from '../../../url/index';
import type { FetchResponse } from '../../../fetch/index';

import type { BrowletEnvironmentBase } from '../../environment';

import { EmbedderPolicy } from './coep';

/** Browsing-context isolation requirements and their reporting endpoints. */
// https://html.spec.whatwg.org/multipage/browsers.html#cross-origin-opener-policy
export class OpenerPolicy {
  /** Enforced browsing-context isolation policy. */
  value: OpenerPolicyValue = 'unsafe-none';
  /** Named endpoint for enforced-policy reports, when configured. */
  reportingEndpoint: string | null = null;
  /** Policy evaluated without enforcing a group switch. */
  reportOnlyValue: OpenerPolicyValue = 'unsafe-none';
  /** Named endpoint for report-only violations, when configured. */
  reportOnlyReportingEndpoint: string | null = null;

  /** Obtain both dispositions from a response in its reserved environment. */
  // https://html.spec.whatwg.org/multipage/browsers.html#obtain-coop
  static obtain(response: FetchResponse, env: BrowletEnvironmentBase): OpenerPolicy {
    const policy = new OpenerPolicy();
    if (!env.isSecureContext) return policy;
    const coep = EmbedderPolicy.obtain(response, env);
    for (const reportOnly of [false, true]) {
      const header = reportOnly ? 'Cross-Origin-Opener-Policy-Report-Only' : 'Cross-Origin-Opener-Policy';
      const item = response.headerList.getStructuredFieldValue(header, 'item');
      if (item?.bareItem.type !== 'token') continue;
      const token = item.bareItem.value;
      let value: OpenerPolicyValue = 'unsafe-none';
      if (token === 'same-origin') {
        value = EmbedderPolicy.isCompatibleWithCrossOriginIsolation(coep.value) ||
          (reportOnly && EmbedderPolicy.isCompatibleWithCrossOriginIsolation(coep.reportOnlyValue))
          ? 'same-origin-plus-COEP' : 'same-origin';
      } else if (token === 'same-origin-allow-popups' || (!reportOnly && token === 'noopener-allow-popups')) {
        value = token;
      }
      const parameter = item.parameters.get('report-to');
      const endpoint = parameter?.type === 'string' ? parameter.value : null;
      if (reportOnly) {
        policy.reportOnlyValue = value;
        policy.reportOnlyReportingEndpoint = endpoint;
      } else {
        policy.value = value;
        policy.reportingEndpoint = endpoint;
      }
    }
    return policy;
  }

  // https://html.spec.whatwg.org/multipage/browsers.html#matching-coop
  static matchValues(
    documentCOOP: OpenerPolicyValue, documentOrigin: Origin,
    responseCOOP: OpenerPolicyValue, responseOrigin: Origin,
  ): boolean {
    if (documentCOOP === 'unsafe-none' && responseCOOP === 'unsafe-none') return true;
    if (documentCOOP === 'unsafe-none' || responseCOOP === 'unsafe-none') return false;
    return documentCOOP === responseCOOP && areSameOrigin(documentOrigin, responseOrigin);
  }

  // https://html.spec.whatwg.org/multipage/browsers.html#check-browsing-context-group-switch-coop-value-popup
  static popupRequiresGroupSwitch(
    responseOrigin: Origin, activeDocumentNavigationOrigin: Origin,
    responseCOOPValue: OpenerPolicyValue, activeDocumentCOOPValue: OpenerPolicyValue,
  ): boolean {
    if (responseCOOPValue === 'noopener-allow-popups') return true;
    if ((activeDocumentCOOPValue === 'same-origin-allow-popups' || activeDocumentCOOPValue === 'noopener-allow-popups') &&
      responseCOOPValue === 'unsafe-none') return false;
    return !OpenerPolicy.matchValues(
      activeDocumentCOOPValue, activeDocumentNavigationOrigin, responseCOOPValue, responseOrigin,
    );
  }

  // https://html.spec.whatwg.org/multipage/browsers.html#check-browsing-context-group-switch-coop-value
  static requiresGroupSwitch(
    isInitialAboutBlank: boolean, responseOrigin: Origin, activeDocumentNavigationOrigin: Origin,
    responseCOOPValue: OpenerPolicyValue, activeDocumentCOOPValue: OpenerPolicyValue,
  ): boolean {
    if (isInitialAboutBlank) {
      return OpenerPolicy.popupRequiresGroupSwitch(
        responseOrigin, activeDocumentNavigationOrigin, responseCOOPValue, activeDocumentCOOPValue,
      );
    }
    // SPEC_CLASH(coop-noopener-navigation): follow the matching algorithm; the introduction says always switch.
    return !OpenerPolicy.matchValues(
      activeDocumentCOOPValue, activeDocumentNavigationOrigin, responseCOOPValue, responseOrigin,
    );
  }

  // https://html.spec.whatwg.org/multipage/browsers.html#check-bcg-switch-navigation-report-only
  static reportOnlyRequiresGroupSwitch(
    isInitialAboutBlank: boolean, responseOrigin: Origin, activeDocumentNavigationOrigin: Origin,
    responseCOOP: OpenerPolicy, activeDocumentCOOP: OpenerPolicy,
  ): boolean {
    if (!OpenerPolicy.requiresGroupSwitch(isInitialAboutBlank, responseOrigin, activeDocumentNavigationOrigin,
      responseCOOP.reportOnlyValue, activeDocumentCOOP.reportOnlyValue)) return false;
    return OpenerPolicy.requiresGroupSwitch(isInitialAboutBlank, responseOrigin, activeDocumentNavigationOrigin,
      responseCOOP.value, activeDocumentCOOP.reportOnlyValue) ||
      OpenerPolicy.requiresGroupSwitch(isInitialAboutBlank, responseOrigin, activeDocumentNavigationOrigin,
        responseCOOP.reportOnlyValue, activeDocumentCOOP.value);
  }

  /** Select the configured report destination for this disposition. */
  reportingEndpointForDisposition(disposition: 'enforce' | 'reporting'): string | null {
    // SPEC_CLASH(coop-report-endpoint): use disposition-specific endpoints, as WebKit does; HTML always names the enforced endpoint.
    return disposition === 'reporting' ? this.reportOnlyReportingEndpoint : this.reportingEndpoint;
  }

  // https://html.spec.whatwg.org/multipage/browsers.html#coop-violation-navigation-to
  queueNavigationToReport(
    disposition: 'enforce' | 'reporting', _coopURL: URLRecord, _previousResponseURL: URLRecord,
    _coopOrigin: Origin, _previousResponseOrigin: Origin, _referrer: URLRecord | null | undefined,
  ): void {
    if (this.reportingEndpointForDisposition(disposition) === null) return;
    // TODO: construct the navigation-to body and submit it through Reporting's
    // URL-scoped queue; the current queue requires a live destination global.
    throw new InternalError('COOP navigation reporting requires a URL-scoped Reporting queue');
  }

  // https://html.spec.whatwg.org/multipage/browsers.html#coop-violation-navigation-from
  queueNavigationFromReport(
    disposition: 'enforce' | 'reporting', _coopURL: URLRecord, _nextResponseURL: URLRecord,
    _coopOrigin: Origin, _nextResponseOrigin: Origin, _isCOOPResponseNavigationSource: boolean,
  ): void {
    if (this.reportingEndpointForDisposition(disposition) === null) return;
    // TODO: apply next-URL disclosure rules and retain the prior response's
    // reporting configuration independently of a live global.
    throw new InternalError('COOP navigation reporting requires a URL-scoped Reporting queue');
  }
}

/** Remove credentials and fragments without changing the retained URL. */
// https://html.spec.whatwg.org/multipage/browsers.html#sanitize-url-report
export function sanitizeURLForReport(url: URLRecord): string {
  const sanitizedURL = copyURL(url);
  sanitizedURL.username = '';
  sanitizedURL.password = '';
  return serializeURL(sanitizedURL, true);
}

export type OpenerPolicyValue =
  | 'unsafe-none'
  | 'same-origin-allow-popups'
  | 'same-origin'
  | 'same-origin-plus-COEP'
  | 'noopener-allow-popups';
