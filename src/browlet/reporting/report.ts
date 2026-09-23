import {
  defineInterface, idlType, impl, nullable, op, reference, roAttr, xattr,
} from '../../web-idl/index';
import { utf8Encode } from '../../encoding/index';
import type { Origin } from '../../url/index';

/** A generated report shared by local observers, buffering, and the outbound queue. */
// https://w3c.github.io/reporting/#dom-report
export class ReportImpl {
  /** Producer-supplied JSON-serializable object, or null when there is no body. */
  data: unknown;
  /** Report type identifying the body's format. */
  type: string;
  /** Sanitized URL of the document or worker that generated the report. */
  url: string;
  /** Concrete observer body, or null when absent or its interface is not implemented. */
  body: ReportBodyImpl | null = null;
  /** Source URL's origin retained before sanitization can remove the URL's structure. */
  origin: Origin;
  /** Environment's effective identification value captured at generation. */
  userAgent: string;
  /** Name of the endpoint selected by the reporting policy. */
  destination: string;
  /** Generation time as a Unix timestamp in milliseconds. */
  timestamp = Date.now();
  /** Number of attempts to deliver this report. */
  attempts = 0;

  constructor(data: unknown, type: string, destination: string, url: string, origin: Origin, userAgent: string) {
    this.data = data;
    this.type = type;
    this.destination = destination;
    this.url = url;
    this.origin = origin;
    this.userAgent = userAgent;
  }

  /** Copy outbound data without retaining the observer body or binding-owned identity. */
  cloneForDelivery(): ReportImpl {
    const data: unknown = JSON.parse(JSON.stringify(this.data));
    const copy = new ReportImpl(data, this.type, this.destination, this.url, this.origin, this.userAgent);
    copy.timestamp = this.timestamp;
    copy.attempts = this.attempts;
    return copy;
  }

  /** Serialize reports without changing delivery bookkeeping. */
  // https://w3c.github.io/reporting/#serialize-reports
  // Reviewed departure: attempts advance when delivery begins, not when data is inspected.
  static serialize(reports: ReportImpl[]): Uint8Array<ArrayBuffer> {
    const now = Date.now();
    return utf8Encode(JSON.stringify(reports.map((report) => ({
      age: now - report.timestamp,
      type: report.type,
      url: report.url,
      user_agent: report.userAgent,
      body: report.data,
    }))));
  }
}

/** Base implementation for report-specific platform interfaces. */
// https://w3c.github.io/reporting/#reportbody
export class ReportBodyImpl {}

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
