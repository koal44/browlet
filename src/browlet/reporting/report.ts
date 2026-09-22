import {
  defineInterface, idlType, impl, nullable, op, reference, roAttr, xattr,
} from '../../web-idl/index';
import { getEnvironmentDefaultUserAgent } from '../../fetch/index';
import { stripURLForReporting } from '../../url/index';
import type { Environment } from '../scripting/environment';

/** Observer-facing report data, independent of network delivery bookkeeping. */
// https://w3c.github.io/reporting/#dom-report
export class ReportImpl {
  /** Report type identifying the body's format. */
  #type: string;
  /** Sanitized URL of the document or worker that generated the report. */
  #url: string;
  /** Concrete report body, or null when the report has no body. */
  #body: ReportBodyImpl | null;

  constructor(type: string, url: string, body: ReportBodyImpl | null) {
    this.#type = type;
    this.#url = url;
    this.#body = body;
  }

  get type(): string {
    return this.#type;
  }

  get url(): string {
    return this.#url;
  }

  get body(): ReportBodyImpl | null {
    return this.#body;
  }
}

/** Base implementation for report-specific platform interfaces. */
// https://w3c.github.io/reporting/#reportbody
export class ReportBodyImpl {}

/** Create pending report data, capturing the environment's current identification value. */
// https://w3c.github.io/reporting/#queue-report
export function generateReport(
  data: unknown, type: string, destination: string, environment: Environment,
): Report {
  // HTML's NavigatorID.userAgent uses this same environment-default algorithm.
  return {
    body: data,
    url: stripURLForReporting(environment.creationURL),
    userAgent: getEnvironmentDefaultUserAgent(environment),
    destination,
    type,
    timestamp: Date.now(),
    attempts: 0,
  };
}

/** Pending report data and delivery bookkeeping, separate from its observer projection. */
// https://w3c.github.io/reporting/#concept-reports
export type Report = {
  /** Producer-supplied JSON-serializable object, or null when there is no body. */
  body: unknown;
  /** Serialized source URL with credentials and fragment removed. */
  url: string;
  /** Environment's effective identification value captured when the report was generated. */
  userAgent: string;
  /** Name of the endpoint selected by the reporting policy. */
  destination: string;
  /** Nonempty report type identifying the body's format. */
  type: string;
  /** Generation time as a Unix timestamp in milliseconds. */
  timestamp: number;
  /** Number of attempts to deliver this report. */
  attempts: number;
};

// -- Web IDL ------------------------------------------------------------

// The draft's dictionaries leave polymorphic body initialization unresolved.
// Follow the browsers' interface inheritance; default toJSON projects the
// declared attributes without adding serialization behavior to implementations.
/*
 * [Exposed=(Window,Worker), LegacyNoInterfaceObject]
 * interface Report {
 *   readonly attribute DOMString type;
 *   readonly attribute DOMString url;
 *   readonly attribute ReportBody? body;
 *   [Default] object toJSON();
 * };
 *
 * [Exposed=(Window,Worker)]
 * interface ReportBody {
 *   [Default] object toJSON();
 * };
 */
export const reportIDL = defineInterface({
  name: 'Report',
  exposed: ['Window', 'Worker'],
  ...xattr('LegacyNoInterfaceObject'),
  implementation: impl(ReportImpl),
  members: [
    roAttr('type', idlType.DOMString),
    roAttr('url', idlType.DOMString),
    roAttr('body', nullable(reference('ReportBody'))),
    op('toJSON', idlType.object, [], xattr('Default')),
  ],
});

export const reportBodyIDL = defineInterface({
  name: 'ReportBody',
  exposed: ['Window', 'Worker'],
  implementation: impl(ReportBodyImpl),
  members: [op('toJSON', idlType.object, [], xattr('Default'))],
});
