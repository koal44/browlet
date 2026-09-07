# Fetch dependency preflight

Reviewed 2026-09-06. This file owns the dependency work order, suggested folder
layout, and local reference inventory. The [Fetch roadmap](roadmap.md) owns
Fetch's implementation slices; the linked subsystem roadmaps own detailed
scope, implementation status, tests, and stopping points.

This is the agreed detour from [Browlet's priority order](../browlet/priority.md).
Read each named specification, then implement the portion assigned by its
owner. Where a dependency consumes Fetch itself, finish its independent work
first and integrate it with real Fetch records/lifecycle later. CSP stays last.

## Suggested folder structure

This is a **suggested implementation layout**. The new directories contain
roadmaps only; source filenames may change as implementation becomes concrete.
Add a TypeScript project/build reference when its first source is implemented,
not merely because its roadmap exists. No new Git repositories or published
packages are implied.

```text
src/
├── struct-fields/
│   ├── roadmap.md
│   ├── values.ts
│   ├── parse.ts
│   └── serialize.ts
├── cookies/
│   └── roadmap.md
├── storage/
│   └── roadmap.md
├── fetch/
│   ├── roadmap.md
│   ├── preflight.md
│   ├── integrity.ts
│   ├── multipart/
│   │   └── roadmap.md
│   └── http/
│       ├── roadmap.md
│       ├── syntax.ts
│       ├── metadata.ts
│       └── cache/
│           └── roadmap.md
├── file/
│   ├── roadmap.md
│   └── blob-url-store.ts
├── xhr/
│   ├── roadmap.md
│   └── form-data.ts
└── browlet/
    ├── browsing/
    │   └── policy/
    │       ├── roadmap.md
    │       ├── container.ts
    │       ├── secure-contexts.ts
    │       ├── referrer-policy.ts
    │       ├── integrity-policy.ts
    │       ├── hsts.ts
    │       ├── mixed-content.ts
    │       ├── upgrade-insecure-requests.ts
    │       └── csp/
    │           └── roadmap.md
    ├── storage/
    │   └── roadmap.md
    ├── reporting/
    │   └── roadmap.md
    └── performance/
        └── roadmap.md
```

Structured fields, cookies, and the Storage substrate have independent
consumers and proposed top-level source projects. Multipart and HTTP caching
remain within Fetch. Browser policy, report delivery, and timing remain in
Browlet. Store instances still belong to the appropriate browser lifetime;
a shared source project does not imply shared process-global state.

## Work order

Follow this order for the independently implementable portions. Status and
acceptance criteria live in the linked owner, not in a second checklist here.

| Order | Work / authoritative plan | First integration point |
| --- | --- | --- |
| 1 | [Structured fields](../struct-fields/roadmap.md), RFC 9651 | Fetch header operations |
| 2 | [Multipart bytes](multipart/roadmap.md), RFC 7578 + HTML/Fetch | Body extraction/consumption |
| 3 | [HTTP semantics](http/roadmap.md) and [HTTP caching](http/cache/roadmap.md), RFCs 9110/9111/5861 | Response freshness, then cache transactions |
| 4 | [Trustworthiness](../browlet/browsing/policy/roadmap.md#trustworthiness), Secure Contexts | Browser policy and Metadata inputs |
| 5 | [Cookies](../cookies/roadmap.md), the current HTTPWG draft + HTML/Fetch | HTTP cookie processing, then HTML consumers |
| 6 | [Referrer Policy](../browlet/browsing/policy/roadmap.md#referrer-policy) | Request/redirect handling and policy delivery |
| 7 | [Fetch Metadata](http/roadmap.md#fetch-metadata) | Outgoing HTTP request headers |
| 8 | [SRI verification](roadmap.md#subresource-integrity) and [Integrity Policy](../browlet/browsing/policy/roadmap.md#integrity-policy) | Response bytes and request policy |
| 9 | [HSTS](../browlet/browsing/policy/roadmap.md#hsts), RFC 6797 | Scheme upgrading and secure transport |
| 10 | [Storage keys](../storage/roadmap.md#first-slice--storage-keys), then [File's Blob URL slice](../file/roadmap.md#slice-4--blob-url-store-and-urlfetch-integration-deferred) | URL resolution, Fetch, and environment teardown |

Existing foundations are indexed in Fetch's
[dependency ledger](roadmap.md#dependency-ledger). In particular, the
[FormData entry list](../xhr/roadmap.md) and Blob/File bytes already exist;
their remaining multipart and Blob URL work has the owners linked above.

## Rejoin Fetch, then finish browser policy

After the independent dependency work, resume the [Fetch slices](roadmap.md#slice-1--control-and-task-delivery).
Follow their order for records, APIs, and request processing. Complete the
consumer integration gates in each owning roadmap with real Fetch inputs;
do not construct parallel Request/Response models to avoid those dependencies.

Finish the policy stage in this order:

1. [Mixed Content and Upgrade Insecure Requests](../browlet/browsing/policy/roadmap.md#mixed-content-and-upgrade-insecure-requests).
2. [Reporting](../browlet/reporting/roadmap.md), including its Fetch delivery.
3. [CSP](../browlet/browsing/policy/csp/roadmap.md), last, including delivery of
   its inputs to the preceding policy algorithms.

Configured policy enforcement must have real behavior tests; explicitly
empty policies exercise only the unconfigured path.

Timing integration is owned by the [performance roadmap](../browlet/performance/roadmap.md#fetch-and-navigation-integration).
HTML Web Storage remains in its [browser roadmap](../browlet/storage/roadmap.md).
Their complete API families are not prerequisites for Fetch's initial records.

## Deferred consumers

[Fetch's deferred-work section](roadmap.md#explicitly-deferred-work) owns the
later Service Worker, fetchLater/Permissions Policy, automation, authentication,
and transport gates. The [File roadmap](../file/roadmap.md) owns Blob URL
lifetime/MediaSource exposure, and [XHR](../xhr/roadmap.md) retains form-backed
FormData construction. This index does not repeat those implementation plans.

## Local reference inventory

Root: `C:/Users/rando/source/repos/_web-platform/specs/`.
The paths below are relative to that root. Existing checkouts were reused;
the missing repositories were shallow-cloned and the published RFC texts
downloaded on 2026-09-06. These are reference sources, not installed runtime
dependencies. Prefer the listed editable source over generated snapshots.

| Specification / evidence | Local source | Acquisition |
| --- | --- | --- |
| Fetch | `whatwg-fetch/fetch.bs` | Existing |
| HTML | `whatwg-html/source` | Existing |
| XHR / FormData | `whatwg-xhr/xhr.bs` | Existing |
| File API | `w3c-file-api/index.bs` | Existing |
| RFC 9651 | `rfcs/rfc9651.txt` | Published RFC |
| RFC 7578; supporting MIME rules | `rfcs/rfc7578.txt`, `rfcs/rfc2046.txt`, `rfcs/rfc2183.txt` | Published RFCs |
| HTTP semantics/cache/stale extensions | `rfcs/rfc9110.txt`, `rfcs/rfc9111.txt`, `rfcs/rfc5861.txt` | Published RFCs |
| HSTS | `rfcs/rfc6797.txt` | Published RFC |
| HTTP/1.1 and extensible priorities | `rfcs/rfc9112.txt`, `rfcs/rfc9218.txt` | Published RFCs; supporting transport references |
| [Structured-field test vectors](https://github.com/httpwg/structured-field-tests) | `httpwg-structured-field-tests/README.md` and JSON fixtures | New; `1e280c3` |
| [Cookies / HTTPWG drafts](https://github.com/httpwg/http-extensions) | `httpwg-http-extensions/draft-ietf-httpbis-layered-cookies.md` | New; `1057fe0` |
| [Secure Contexts](https://w3c.github.io/webappsec-secure-contexts/) | `w3c-secure-contexts/index.bs` | New; `68191bb` |
| [Referrer Policy](https://w3c.github.io/webappsec-referrer-policy/) | `w3c-referrer-policy/index.src.html` | New; `cc435b0` |
| [Fetch Metadata](https://w3c.github.io/webappsec-fetch-metadata/) | `w3c-fetch-metadata/index.bs` | New; `6d0c5bf` |
| [SRI / Integrity Policy](https://w3c.github.io/webappsec-subresource-integrity/) | `w3c-subresource-integrity/index.bs` | New; `632bf53` |
| [Storage](https://storage.spec.whatwg.org/) | `whatwg-storage/storage.bs` | New; `1933f42` |
| [Mixed Content](https://w3c.github.io/webappsec-mixed-content/) | `w3c-mixed-content/index.bs` | New; `a4eacec` |
| [Upgrade Insecure Requests](https://w3c.github.io/webappsec-upgrade-insecure-requests/) | `w3c-upgrade-insecure-requests/index.bs` | New; `87d0b9d` |
| [CSP Level 3](https://w3c.github.io/webappsec-csp/) | `w3c-csp/index.bs` | New; `e81d712` |
| [Reporting](https://w3c.github.io/reporting/) | `w3c-reporting/index.bs` | New; `57e73b5` |
| [Resource Timing](https://w3c.github.io/resource-timing/) | `w3c-resource-timing/index.bs` | New; `1f9ef25` |
| [Performance Timeline](https://w3c.github.io/performance-timeline/) | `w3c-performance-timeline/index.bs` | New; `8aa7b1d` |
| [Navigation Timing](https://w3c.github.io/navigation-timing/) | `w3c-navigation-timing/index.bs` | New; `245fee2` |
| [Server Timing](https://w3c.github.io/server-timing/) | `w3c-server-timing/index.bs` | New; `573ee35` |
| [Permissions Policy](https://w3c.github.io/webappsec-permissions-policy/) | `w3c-permissions-policy/index.bs` | New; `c10c76d` |
| [Service Workers](https://w3c.github.io/ServiceWorker/) | `w3c-service-workers/index.bs` | New; `92aba3b` |
| [WebDriver BiDi](https://w3c.github.io/webdriver-bidi/) | `w3c-webdriver-bidi/index.bs` | New; `242588e` |

The existing Infra, URL, Encoding, MIME Sniffing, Streams, Web IDL, and High
Resolution Time checkouts remain the reference sources for completed
foundations. Undici and browser source checkouts are implementation evidence;
their behavior does not override a normative requirement.

## Maintaining these plans

Record implemented scope, spec revision, observable tests, and remaining gaps
in the owning roadmap. Parent plans retain ordering and links. Move detail
when ownership changes rather than copying the same checklist into each
ancestor. Reference paths/revisions are catalogued above; downloaded sources
are not implemented dependencies.

The dependency review covers Fetch's direct surface and the additional
multipart/trust/storage prerequisites found so far. It does not claim a full
transitive audit of CSP, workers, or every transport protocol. Record a newly
required specification at its actual consumer before expanding the plan.
Keep new failures ordinary failures until Eric agrees to another status.
