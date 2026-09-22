# Reporting roadmap

This folder will own Browlet's implementation of the
[Reporting API](https://w3c.github.io/reporting/): endpoint configuration,
report records/queues, delivery, and observer projection. Policy subsystems
decide which violations to report and supply their report bodies; Reporting
owns the shared lifecycle.

**Status:** generation, queues, delivery, and observers are planned. URL owns the
stateless stripping helper; the empty `ReportBody` dictionary is implemented for Integrity
Policy; they do not implement report generation or delivery.

Fetch 7c has reached the first concrete consumer: COEP's CORP violation reports.
FetchResponse implements the policy checks and submits violations through
`settings.queueReport()`. EnvironmentSettingsObject currently discards those
reports through an explicitly provisional no-op, approved for this stage.
Replace that method with real generation and queuing during step 2 below;
network delivery still needs the later Fetch pipeline.

`FetchRequest.isBlockedByIntegrityPolicy()` also submits reports through that same method, with boolean
`reportOnly` fields. Its derived dictionary is registered at Browlet's binding
composition root; the current Reporting draft defines `ReportBody` as a
dictionary, not an interface. Window settings' `getReportingSource()` selects
the live associated Document URL, independently of its base/referrer URL.
Future Worker settings must implement that operation for their own URL.
No private policy report queue has been introduced.

## Sources and dependencies

Local source: `w3c-reporting/index.bs` under the
[reference root](../../fetch/PREFLIGHT.md#local-reference-inventory).
Use its generic and document-centered reporting frameworks, endpoint-header
processing, delivery algorithms, and Reporting Observers section.

`Reporting-Endpoints` uses [structured fields](../../http/struct-fields/README.md),
URL parsing, and the [policy owner's](../browsing/policy/ROADMAP.md)
trustworthiness operation. Globals own endpoint/report state as specified;
HTML supplies settings, lifecycle, and task delivery. The current
document-centered reports follow their document/worker lifetime.

Before implementing that ownership, reconcile the current text: Fetch's CORP
report algorithm passes a global, Reporting §3.4.1 accepts a Document/worker,
and Reporting §3.1 declares the queues on WindowOrWorkerGlobalScope. Keep this
adaptation within Browlet rather than exposing DOM ownership details to Fetch.
The actual settings object already reaches its global through
`realmExecutionContext.realm.globalObject`; Fetch does not need that field in
its narrowed contract. Queued report records are distinct from HTML tasks:
observer callbacks require task delivery, while network delivery batches
pending reports according to the user agent's schedule.

## Implementation order

1. **Records and configuration.** Implement endpoints, reports, response-header
   processing, and global endpoint-list initialization. Reject invalid or
   untrustworthy endpoints according to the algorithm and preserve per-global
   ownership.
2. **Generation and queues.** Implement generate-and-queue using the existing URL stripping helper,
   report serialization, and report-type visibility. CSP, COEP, and Integrity
   Policy consume these operations without private delivery queues.
3. **Observers.** Add Report/ReportBody/ReportingObserver declarations and
   implementation, buffering, callback delivery, and disconnect/takeRecords
   behavior through the existing Web IDL and HTML lifecycle.
4. **Delivery.** Implement grouping, attempt bookkeeping, and response/failure
   handling using Fetch-created requests. Reporting delivery is best effort;
   test the specified algorithm and configured scheduling rather than promising
   unconditional delivery or using arbitrary sleeps.

Records, configuration, generation, and observers are the next preflight detour
after SRI, before HSTS. Network delivery depends on Fetch and is completed at the
[preflight's final policy stage](../../fetch/PREFLIGHT.md#rejoin-fetch-then-finish-browser-policy).
Network Error Logging and the repository's separate network-reporting draft
are not automatically included by implementing document-centered reporting.

## User control

[Reporting §9.4](https://w3c.github.io/reporting/#disable) requires users to be
able to disable reporting with reasonable granularity. Include a Browlet
configuration control when replacing the provisional no-op; decide its scope
and treatment of already queued reports before exposing delivery. Define the
relationship between network opt-out and local observers explicitly.

Disabling reports must not disable CSP, COEP, or Integrity Policy enforcement.
In particular, do not implement opt-out by returning null from
`getReportingSource()`: Integrity Policy uses that result to distinguish globals
outside Window/Worker. Keep the source identity and apply report preferences
inside Reporting. Test disabled submission/delivery alongside an integrity
violation that still blocks its request.

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

URL stripping intentionally preserves the input and removes the entire fragment,
instead of mutating it and leaving a trailing `#` as the draft's literal steps
would do. This approved behavior matches Gecko's `ReportingUtils::StripURL` and
Blink's sanitization. HTTP(S) retains path/query; other schemes disclose only the
scheme. The helper lives in `src/url/url.ts`, with tests in `test/url/url-reporting.test.ts`.
