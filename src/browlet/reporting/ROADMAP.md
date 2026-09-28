# Reporting roadmap

[Reporting](https://w3c.github.io/reporting/) owns endpoint configuration, report
records, observers, delivery, and retirement. Policy owners decide when to report
and supply their bodies. The Window API and independent delivery algorithms are
implemented, including real Fetch uploads that survive Document destruction.
Automatic collection, periodic retirement, and other global lifecycles remain below.

## Current contracts

| Owner | Responsibility |
| --- | --- |
| `ReportImpl` | Observer-visible fields, producer data, original origin, delivery bookkeeping, copying, and serialization |
| `WindowOrWorkerGlobalScopeMixin` | Endpoint configuration, outbound queue, observer registrations, replay buffer, and cleanup |
| `Environment` | Report generation, current reporting URL, identification, and access to the actual global |
| `ReportingObserverImpl` | Registration options, pending callback batch, and projected observer operations |
| `UserAgent` | Delivery preferences, age/failure limits, host scheduling, sandbox execution, and Fetch attempts |

Document creation initializes endpoints from its actual Fetch response.
`Reporting-Endpoints` parsing uses [Structured Fields](../../http/README.md#structured-fields),
the final response URL, and the UserAgent's trust policy. Malformed dictionary
syntax rejects the configuration; valid non-string members are ignored.
Relative references resolve against the complete response URL. Empty or aborted
parsing produces an empty configuration.

COEP, Integrity Policy, CSP, and test reports reach the shared observer/outbound
paths. Window reporting uses the associated Document's current URL, independently
of its base or referrer URL. Workers must supply their own source URL. Fetch's
narrow environment contract does not need to know about the global-scope mixin.

A generated report retains its concrete body once. Observers and buffered replay
share report/body identity; Web IDL preserves the derived interface through
`Report.body`. Unknown report types can be delivered but are not exposed locally.
The replay buffer retains at most 100 reports per type. Converted callbacks run
on HTML tasks with the callback's realm and exception handling.

## Delivery and lifetime

`sendReports(reports, env)` groups by endpoint identity and original report origin.
`cloneForDelivery()` copies JSON data and metadata into an unbound `ReportImpl`,
omitting the observer body and references to the generating environment.
Sanitized non-HTTP URLs cannot reconstruct the original origin, so the report
retains it separately; opaque origins compare by identity.

Delivery retains both the selected endpoint and its configuration list. Removing
an endpoint must affect that original configuration, not a replacement list or
another global with an equal URL. Cleanup replaces the global's list reference
without invalidating an already handed-off batch.

The UserAgent schedules delivery on later host turns, yielding while its started
HTML loops have runnable work. Inactive-Document tasks and manually driven loops
do not block it. Its internal host Promises remain independent of page checkpoints.
Each attempt rechecks age and opt-out, then uses ordinary Fetch: clientless POST,
CORS, same-origin credentials, report destination, low priority, no prompt target,
and no Service Worker interception. Response handling classifies success, endpoint
removal, or failure and disposes the unused body.

Body streams still need an execution owner. The UserAgent lazily retains a
sandbox environment with a real Realm, SandboxAgent, and running loop; it creates
no Window or Document and installs no author interfaces. The upload retains its
original origin/network state. The sandbox supplies execution without becoming
the request's client or initiating security identity.

This ownership follows the purpose of
[Blink's browser reporting service](https://github.com/chromium/chromium/blob/main/net/reporting/reporting_uploader.cc),
Gecko's `dom/reporting/ReportDeliver.cpp` sandbox, and WebKit's
`Source/WebCore/loader/PingLoader.cpp` keepalive delivery. Those source comparisons
do not imply identical browser internals or immediate release of every frame reference.

`Document.destroy()` hands off outbound reports before clearing local reporting
state and removes the Document's pending tasks. Inactivity alone is not destruction:
history can retain a Document and initial about:blank replacement can reuse its
Window. [History ownership and disposal](../browsing/ROADMAP.md#planned-slice-history-ownership-and-document-disposal)
remain HTML work; Reporting does not require a synchronous destruction-time flush.

## Preferences and retained decisions

`BrowletConfig.reporting` initializes `UserAgent.reportDeliveryEnabled`.
Disabling outbound reports preserves policy enforcement, events, observers, and
buffered replay. Delivery checks the current preference as well as submission.
There is no public per-origin or live-toggle API.

Report generation snapshots the environment's effective User-Agent. The default
comes from `BrowletConfig.userAgent`; a scoped BiDi override, including an empty
one, takes precedence. Navigator's future getter should use the same selector.
An individual request header or later configuration change does not rewrite a report.

Approved choices remain searchable in code. Detailed evidence is in
[the issue notes](../../../scratch/SPEC-ISSUES.md#fetch--reporting-report-recipient-and-queue-owner-disagree);
these September 2026 observations have not been rerun by documentation cleanup.

- Use the browsers' ReportBody interface model, including hidden COEP and test
  bodies, rather than losing derived fields through the draft's dictionaries.
- Replay buffered reports synchronously during `observe()`, consuming the
  buffered option once. Keep the draft's callback registration snapshot;
  disconnect unregisters without clearing a pending batch.
- Preserve source URLs and remove fragments entirely. HTTP(S) reports retain
  path/query; other schemes disclose only their scheme.
- Follow the generation algorithm's current User-Agent rather than the prose's
  original-request value.
- Serialization has no bookkeeping side effects; attempts increment when delivery
  begins. Success resets consecutive failures. Test reports use `message`.
- Endpoint parsing follows the written string-member/trust rules despite browser
  parser differences and the draft's obsolete HTTPS-state alternative.

The default maximum age is two days and the endpoint failure limit is five.
Retirement covers outbound reports, replay buffers, and observer batches.
Disconnected observers retire old records when consumed. Attempted reports are
released; the draft does not settle retry policy.

## Remaining work

- Connect automatic collection of live globals' queues and periodic retirement.
  A task scheduler alone does not choose those policies.
- Integrate worker globals, source URLs, endpoint initialization, and termination
  with the [worker lifecycle](../workers/ROADMAP.md).
- Complete HTML history/disposal and other producer lifecycles at their owners.
  Fetch group cancellation is still provisional; parser registration and network
  delivery already exist.
- Connect the test-report generator to real WebDriver session/context/prompt
  handling. BiDi hooks currently use their no-session defaults.
- Add finer user controls if required by Reporting §9.4. Network Error Logging
  and the separate network-reporting draft are additional scope.

## Validation and sources

[Reporting tests](../../../test/browlet/reporting/) cover endpoint parsing,
generation, derived projection, observers, serialization, retirement, opt-out,
and endpoint isolation. `fetch-delivery.test.ts` covers real OPTIONS/POST delivery,
failure/removal, destruction before and during uploads, and unused-body disposal.
These proofs do not establish periodic scheduling or inactive-history disposal.

The local source is `w3c-reporting/index.bs` under the
[reference root](../../fetch/README.md#sources). Use its generic and
document-centered frameworks together; keep the global/Document adaptation
inside Browlet. Policy-specific report-only/enforcement tests stay with producers.
