# Reporting roadmap

This folder will own Browlet's implementation of the
[Reporting API](https://w3c.github.io/reporting/): endpoint configuration,
report records/queues, delivery, and observer projection. Policy subsystems
decide which violations to report and supply their report bodies; Reporting
owns the shared lifecycle.

**Status:** planned. Policy placeholders and console logging do not implement
report generation or delivery.

## Sources and dependencies

Local source: `w3c-reporting/index.bs` under the
[reference root](../../fetch/preflight.md#local-reference-inventory).
Use its generic and document-centered reporting frameworks, endpoint-header
processing, delivery algorithms, and Reporting Observers section.

`Reporting-Endpoints` uses [structured fields](../../http/struct-fields/roadmap.md),
URL parsing, and the [policy owner's](../browsing/policy/roadmap.md)
trustworthiness operation. Globals own endpoint/report state as specified;
HTML supplies settings, lifecycle, and task delivery. The current
document-centered reports follow their document/worker lifetime.

## Implementation order

1. **Records and configuration.** Implement endpoints, reports, response-header
   processing, and global endpoint-list initialization. Reject invalid or
   untrustworthy endpoints according to the algorithm and preserve per-global
   ownership.
2. **Generation and queues.** Implement generate-and-queue, URL stripping,
   report serialization, and report-type visibility. CSP, COEP, and Integrity
   Policy consume these operations without private delivery queues.
3. **Delivery.** Implement grouping, attempt bookkeeping, and response/failure
   handling using Fetch-created requests. Reporting delivery is best effort;
   test the specified algorithm and configured scheduling rather than promising
   unconditional delivery or using arbitrary sleeps.
4. **Observers.** Add Report/ReportBody/ReportingObserver declarations and
   implementation, buffering, callback delivery, and disconnect/takeRecords
   behavior through the existing Web IDL and HTML lifecycle.

Delivery depends on Fetch and is therefore completed during the
[preflight's final policy stage](../../fetch/preflight.md#rejoin-fetch-then-finish-browser-policy).
Network Error Logging and the repository's separate network-reporting draft
are not automatically included by implementing document-centered reporting.

## Exit proof

Test endpoint parsing, per-global isolation, queue/serialization results,
required URL sanitization, report visibility, and lifetime cleanup. Then
observe real Fetch delivery requests, failures and successful completion with
a deterministic host. Projected observer tests cover buffered reports,
callback scheduling, and disconnect behavior in the relevant realm.

Report-only versus enforcing policy tests belong to each policy owner;
Reporting must preserve their report data without deciding whether a resource
is allowed. Remove this roadmap when the reached producers, delivery path,
and exposed observer API are covered.
