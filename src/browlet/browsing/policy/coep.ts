import type { FetchEmbedderPolicyValue } from '../../../fetch/index';
import { defineInterface, idlType, impl, op, roAttr, xattr } from '../../../web-idl/index';
import { ReportBodyImpl } from '../../reporting/report';

/** https://html.spec.whatwg.org/multipage/browsers.html#embedder-policy */
export function createEmbedderPolicy(): EmbedderPolicy {
  return {
    value: 'unsafe-none',
    reportingEndpoint: '',
    reportOnlyValue: 'unsafe-none',
    reportOnlyReportingEndpoint: '',
  };
}

export type EmbedderPolicy = {
  value: EmbedderPolicyValue;
  reportingEndpoint: string;
  reportOnlyValue: EmbedderPolicyValue;
  reportOnlyReportingEndpoint: string;
};

export type EmbedderPolicyValue = FetchEmbedderPolicyValue;

/** Observer-facing snapshot of the COEP report generated for a CORP violation. */
// https://fetch.spec.whatwg.org/#queue-a-cross-origin-embedder-policy-corp-violation-report
export class COEPViolationReportBodyImpl extends ReportBodyImpl implements COEPViolationReportBody {
  /** Kind of COEP violation; the Fetch producer currently supplies corp. */
  #type: string;
  /** Sanitized original response URL. */
  #blockedURL: string;
  /** Intended use of the resource checked by CORP. */
  #destination: string;
  /** Whether the policy was enforcing or only reporting. */
  #disposition: string;

  constructor(body: COEPViolationReportBody) {
    super();
    this.#type = body.type;
    this.#blockedURL = body.blockedURL;
    this.#destination = body.destination;
    this.#disposition = body.disposition;
  }

  get type(): string {
    return this.#type;
  }

  get blockedURL(): string {
    return this.#blockedURL;
  }

  get destination(): string {
    return this.#destination;
  }

  get disposition(): string {
    return this.#disposition;
  }
}

/** JSON fields supplied by Fetch's COEP CORP violation-report algorithm. */
export type COEPViolationReportBody = {
  type: string;
  blockedURL: string;
  destination: string;
  disposition: string;
};

// -- Web IDL ------------------------------------------------------------

// Fetch defines these JSON fields without declaring a report-body interface.
// Use the reviewed hidden-interface model, as WebKit does for its COEP bodies.
/*
 * [Exposed=(Window,Worker), LegacyNoInterfaceObject]
 * interface COEPViolationReportBody : ReportBody {
 *   readonly attribute DOMString type;
 *   readonly attribute USVString blockedURL;
 *   readonly attribute DOMString destination;
 *   readonly attribute DOMString disposition;
 *   [Default] object toJSON();
 * };
 */
export const coepViolationReportBodyIDL = defineInterface({
  name: 'COEPViolationReportBody',
  inherits: 'ReportBody',
  exposed: ['Window', 'Worker'],
  ...xattr('LegacyNoInterfaceObject'),
  implementation: impl(COEPViolationReportBodyImpl),
  members: [
    roAttr('type', idlType.DOMString),
    roAttr('blockedURL', idlType.USVString),
    roAttr('destination', idlType.DOMString),
    roAttr('disposition', idlType.DOMString),
    op('toJSON', idlType.object, [], xattr('Default')),
  ],
});
