# Reporting roadmap

This folder will own Browlet's implementation of the
[Reporting API](https://w3c.github.io/reporting/): endpoint configuration,
report records/queues, delivery, and observer projection. Policy subsystems
decide which violations to report and supply their report bodies; Reporting
owns the shared lifecycle.

**Status:** slice A's records, endpoint parsing, and explicit global endpoint
initialization are implemented. Slice B's Window report submission, queues,
observer interfaces, buffering, callback delivery, and outbound opt-out are
implemented. Destruction cleanup still needs HTML's unfinished Document lifecycle;
worker integration needs worker globals. Slice C owns serialization, retirement,
and delivery. URL owns the stateless stripping helper.

Fetch 7c has reached the first concrete consumer: COEP's CORP violation reports.
FetchResponse implements the policy checks and submits violations through
`settings.queueReport()`. Environment routes those submissions to
its actual Window's global-scope mixin, which generates a report, notifies local
observers, and adds it to the outbound queue when delivery is enabled. Network
delivery still needs the later Fetch pipeline.

`FetchRequest.isBlockedByIntegrityPolicy()` also submits reports through that same method, with boolean
`reportOnly` fields. Its derived body interface is registered at Browlet's binding
composition root, following the approved browser model described below.
Window settings' `getReportingSource()` selects
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

When connecting generation, reconcile the current text: Fetch's CORP
report algorithm passes a global, Reporting §3.4.1 accepts a Document/worker,
and Reporting §3.1 declares the queues on WindowOrWorkerGlobalScope. Keep this
adaptation within Browlet rather than exposing DOM ownership details to Fetch.
The actual settings object reaches its shared implementation state through
`getWindowOrWorkerGlobalScopeMixin()`; Fetch does not need that method in
its narrowed contract. Queued report records are distinct from HTML tasks:
observer callbacks require task delivery, while network delivery batches
pending reports according to the user agent's schedule.

## Implementation slices

### A. Records and endpoint configuration

**Implemented:** §2.1's data model and §§3.1–3.3. `ReportingEndpoint` owns each named URL and
failure count. `Report` describes pending data and delivery bookkeeping;
its body is retained as `unknown`, with each producer responsible for its
concrete type and JSON-serializable data.
`WindowOrWorkerGlobalScopeMixin` owns independent endpoint/report lists and
`initializeReportingEndpoints(response)`. The parser takes the actual Fetch
response and the owning UserAgent for trust decisions. This explicit dependency
has been reviewed and accepted.

Tests in `test/browlet/reporting/endpoints.test.ts` cover final-response-relative
URLs, combined headers and duplicate names, ignored parameters, invalid fields
and URLs, origin trust, replacement, and per-global isolation. The lists exist;
this slice does not submit or deliver reports.

**Consumer gate:** HTML's navigation/worker loader must call initialization with
the actual Fetch response. Navigation still uses its provisional
`NavigationResponse`; do not manufacture a Fetch response merely to adapt that
placeholder. Worker globals are also future work. The explicit initialization
method is tested through real Window ownership meanwhile.

### B. Generation, observers, and user controls

**Implemented for Window globals:** §§2.3, 3.4, 4, 8.1, and 9.4 generation,
queuing, URL sanitization, report-type visibility, ReportingObserver declarations,
buffering, callback delivery, disconnect/takeRecords, and user controls. COEP
and Integrity Policy producers reach actual queues and observers; disabling
outbound reports leaves both enforcement and local observation intact.
Report queues and observer buffers are distinct.

**Implemented boundary:** `ReportImpl` holds the observer-visible type, URL, and
nullable `ReportBodyImpl`; queued `Report` data retains `body: unknown` and its
delivery bookkeeping. `IntegrityViolationReportBodyImpl` snapshots the producer's
four fields. `COEPViolationReportBodyImpl` snapshots CORP's type, blocked URL,
destination, and disposition. Normal Web IDL interface inheritance preserves the concrete body
through `Report.body`, and `[Default] toJSON` supplies serialization. No report-type
projection registry or Binding Context inside implementations is needed.

The draft declares dictionaries and leaves polymorphic body initialization as an
open issue in §4.3. Eric approved following the browsers' interface model instead.
As in Blink/Gecko, `Report` has no global interface object; `ReportBody` and
`IntegrityViolationReportBody` are exposed but have no author constructor.
Fetch defines COEP report fields without a body interface. The reviewed
`COEPViolationReportBody` is a hidden derived interface, following WebKit's
model without adding a global constructor. Blink instead builds these fields
through a generic body JSON implementation.
Gecko/WebKit use default `toJSON` operations. Keep SRI's four field types;
do not import browser feature flags or unrelated report fields.

`test/browlet/reporting/reports.test.ts` covers base-typed derived projection,
JSON output, producer snapshots, getter-only attributes, stable identity, and
cross-realm projection/serialization. The observer constructs the concrete body
before projection. Its constructor receives the owning settings object from
Web IDL and retrieves that environment's existing global-scope mixin. The
environment owns `exec`, so consumers need no separate execution input.
The observer does not construct another mixin or retain a Binding Context.

`generateReport()` implements the generic generation algorithm: it retains
producer data, sanitizes the settings' creation URL without mutating it, and
captures the effective User-Agent, timestamp, destination, and zero attempts.
It does not enqueue or project a report. `test/browlet/reporting/generation.test.ts`
covers that data and the shared identification source described below.

`ReportingObserverImpl` owns registration options and its pending callback batch.
The global-scope mixin owns the registration set and generation-ordered buffer,
limited to 100 reports per type. HTML tasks deliver callbacks through the
converted Web IDL callback, including callback-realm array allocation, receiver
projection, and exception reporting. COEP and integrity violations are the
currently implemented observable types; unknown types remain queued for delivery
but are not exposed locally.

**Reviewed timing choice:** Blink, Gecko, and WebKit replay buffered reports
synchronously during `observe()`, so `takeRecords()` can drain them immediately.
Follow that behavior, consuming the buffered option once. Retain the draft's
registration snapshot when scheduling callback delivery, and skip empty batches.
Disconnecting unregisters the observer without clearing a pending batch.
These details and the accepted draft departure are recorded in
`scratch/SPEC-ISSUES.md`.

`test/browlet/reporting/observers.test.ts` covers actual Window bindings, automatic
HTML task delivery, batching, type conversion/filtering, buffer limits, synchronous
replay, disconnect/takeRecords, reentrant callbacks, exception reporting, realm
ownership, both policy producers, and outbound opt-out.

**Remaining lifecycle dependency:** Document's single-document destroy/abort
methods now call their owners through reviewed provisional contracts. Task
removal, timer cleanup, and `clearReportingState()` work; unimplemented
subsystems use empty typed collections and explicit no-ops. The active-document
destruction test passes, but Fetch cancellation, parser registration, and the
remaining producers still need implementation.
The [browsing roadmap](../browsing/ROADMAP.md#document-destruction-review) owns
that dependency review. Navigation does not invoke destruction yet.
Inactive-document disposal belongs to its own
[HTML lifecycle slice](../browsing/ROADMAP.md#planned-slice-history-ownership-and-document-disposal),
covering history identity, restoration, Window reuse, and child navigables.
Reporting C's independent work can proceed without settling that history API;
production destruction integration remains an explicit consumer gate.
Reporting does not prescribe a destruction flush: slice C must settle any final
outbound handoff before discarding queues/endpoints. Browser source supports
handing delivery data to its owner at generation time: Blink uses its reporting
service, Gecko captures the report for ReportDeliver, and WebKit uses keepalive
violation-report requests. Delivery should survive local observer cleanup
without requiring a synchronous destruction-time flush. Local observer tasks must
be removed before releasing their global state. An inactive Document can be
retained, and initial about:blank replacement can reuse its Window, so neither
inactivity nor every navigation is a destruction notification.

### C. Delivery, serialization, and retirement

Implement §§2.4, 3.5, 5, and the remaining delivery-related privacy rules:
group by endpoint and report origin, create reporting Fetch requests, process
success/failure/410 results, and retire old reports/failing endpoints. Keep
delivery scheduling deterministic in tests and lower priority than page work.
Review the draft's attempt increment inside serialization: bookkeeping belongs
with an actual delivery attempt, while JSON output is a view of report data.
Cover §7's test-report generator; the WebDriver command remains with automation
until that protocol exists. Sections 6 and 10 add examples/registrations, not
another runtime subsystem.

Reporting is the preflight detour after SRI, before HSTS. Network delivery
depends on Fetch and is completed at the
[preflight's final policy stage](../../fetch/PREFLIGHT.md#rejoin-fetch-then-finish-browser-policy).
Network Error Logging and the repository's separate network-reporting draft
are not automatically included by implementing document-centered reporting.

## Endpoint parsing decisions

Follow §3.3's origin-trustworthiness tests for both response and endpoint, using
the existing UserAgent policy (including loopback and explicit trusted origins).
The draft's additional `HTTPS state == modern` alternative refers to a field
current Fetch no longer defines; HTTPS origins already satisfy the trust test.
Return an empty configuration when parsing aborts or the response has no URL.

Malformed Structured Fields syntax rejects the dictionary. A valid dictionary
member that is not a String Item is ignored, as the algorithm explicitly says;
inner lists are not recovered. This differs from the unspecified grammar-error
case we resolved strictly for Integrity Policy. Relative references use the
full final response URL, not just its origin.

Source comparison on 2026-09-21: WebKit's `ReportingScope` follows string-item
filtering, base-URL resolution, and endpoint trust checks. Gecko's
`ReportingHeader::ParseReportingEndpointsHeader` additionally accepts the first
string in an inner list. Chromium's
[network parser](https://raw.githubusercontent.com/chromium/chromium/main/net/reporting/reporting_header_parser.cc)
rejects the whole dictionary for a non-string member and limits endpoint URLs
to cryptographic schemes and absolute/path-absolute forms. Keep the written
Reporting algorithm here; these were source comparisons, not fresh browser
network measurements.

## User-Agent identification

`UserAgent.defaultUserAgentValue` owns the configured default, selected through
`BrowletConfig.userAgent` before the first Window is created. The default is
`Mozilla/5.0 (compatible; Browlet)`, without claiming another browser engine.
Fetch's `getEnvironmentDefaultUserAgent(settings)` asks the UserAgent for the
settings' BiDi override first, including an empty override. Environment has no
BiDi forwarding methods. BiDi session lookup remains an
explicit provisional null result. NavigatorID's future getter should use the
same selector; Reporting does not need a Navigator object to obtain that value.

Reporting's generic generation algorithm explicitly uses the current
`navigator.userAgent`. `generateReport()` captures that effective value so later
configuration changes cannot alter an existing report. The draft's descriptive
definition instead refers to the original request's User-Agent; follow the
generation algorithm here. An explicit header on an individual Fetch request
does not change its environment's identity. A later upload can also use a
different User-Agent from the report data it carries.

Browser source comparison: Blink's `NavigatorBase` and `FrameFetchContext`
reach `FrameLoader::UserAgent`, including embedder and inspector overrides.
WebKit's Navigator and HTTP request setup use `FrameLoader::userAgent`; its
Reporting code obtains the document's HTTP identification value. Gecko's
Navigator uses HTTP defaults, browsing-context overrides, and the document's
channel; Reporting captures identification when registering global endpoints.
These support shared selection but do not establish identical snapshot timing
or override behavior across all three engines.

## User control

[Reporting §9.4](https://w3c.github.io/reporting/#disable) requires users to be
able to disable reporting with reasonable granularity. `BrowletConfig.reporting`
defaults to true and initializes `UserAgent.reportDeliveryEnabled` before the
first global is created. Setting it to false disables outbound queues while
retaining local ReportingObserver callbacks and buffered reports, as approved
by Eric. It applies to the Browlet instance; there is no public per-origin or
live-toggle API. Slice C's delivery path must also honor this preference before
attempting an upload and discard pending outbound reports when disabled.

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
