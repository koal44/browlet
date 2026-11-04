# Browsing policy roadmap

This folder owns browser policy values, response association, inheritance, and
the checks consumed by Fetch and HTML. Fetch's independent policy preflight is
complete; full navigation, nested contexts, elements, and workers still need
their owning integrations. [CSP](csp/ROADMAP.md) owns its language and violations;
[Reporting](../../reporting/ROADMAP.md) owns shared delivery.

## Remaining ownership

| Owner | Missing contract |
| --- | --- |
| Agent selection / loader | Native isolation and WebAssembly.Module cloning/delivery consequences; OAC header processing and historical keys exist (HTML §7.1.2) |
| `coop.ts` / navigation / Reporting | Redirect-loop integration, URL-scoped reports, and cross-window access reports; supplied-response enforcement and group switching exist (HTML §7.1.3) |
| COEP / navigation / workers / Fetch | Child-container lifecycle, blocked-response network errors, worker startup, and PNA/ORB; inheritance checks and reports exist (HTML §7.1.4) |
| Sandbox / iframe / navigation | Child/popup lifecycle and flag consumers; attribute state, creation-flag union, and response preparation exist (HTML §7.1.5) |
| Document ancestry / iframe | Child-container lifecycle; iframe referrer-policy selection, reflection, and ancestry inputs exist (HTML §7.1.6) |
| [Permissions Policy](#permissions-policy) | Feature definitions, policy records, allowlist matching, header/attribute parsing, and iframe inputs exist (§§4–6). §7 inspection, §8 report bodies, §9 checks and producers, and response Document initialization exist. Full child navigation, automatic load-time potential reports, and request-feature consumers remain. Fullscreen's legacy fallback awaits its feature definition. |
| Policy containers / navigation / workers | Navigation source/target snapshots, history reconstruction, worker startup, and origin-independent empty CSP state; selection and initialization algorithms exist (HTML §7.1.7) |

## Permissions Policy clock prerequisite

Temporal's concrete-isolation precision depends on
`Document.isAllowedToUse('cross-origin-isolated')`. Its activity gates and policy
check now work: inherited/header/container restrictions decide availability, with
actual violation reports from §9.10. The supplied-response path installs both
policies. Automatic child creation and the full navigation loader remain unfinished.
This policy is separate from the Permissions API used by Storage.

The [HTML clock integration](../../scripting/ROADMAP.md#8165-temporal-clock-calculation-and-installation-boundary)
installs its callback in every isolation mode. Registration retains the callback
without querying the not-yet-attached Document; navigation installs the Document
and policies before author code runs. Clock reads use the live activity and policy
checks, including violation reports. Retained inactive Documents receive coarser
precision. Native AgentCluster isolation and the existing clock backend/range
limits remain separate from this policy connection.

## HTML 7.1.3 cross-origin opener policies

Audited the complete [COOP section](https://html.spec.whatwg.org/multipage/browsers.html#cross-origin-opener-policies),
including its reporting algorithms, against HTML revision
[`9396777`](https://github.com/whatwg/html/tree/939677714df7379fee3667040113b41c91c851e7)
(26 October 2026). The COEP compatibility predicate and §7.1.4.1 header parser
were included as direct dependencies; the full §7.1.4 audit is recorded below.

| Requirement | Owner and result |
| --- | --- |
| Policy values and matching | `OpenerPolicy` retains both values and nullable endpoints. Matching uses strict origin equality, including opaque identity, and ignores domain relaxation. Two unsafe-none values match across origins. |
| Header processing | `OpenerPolicy.obtain()` uses Fetch's structured-item parser and the reserved environment's security decision. It accepts only tokens, applies string report-to parameters, rejects lists/quoted strings, and preserves the specified difference between enforced and report-only noopener-allow-popups. |
| COEP dependency | `EmbedderPolicy.obtain()` parses both dispositions. Enforced COOP promotion uses enforced COEP; report-only promotion accepts either COEP disposition. The internal same-origin-plus-COEP value is not accepted as a header token. |
| Popup and ordinary navigation comparisons | Static policy operations implement each branch, including the unsafe-none popup allowances and matching report-only suppression. Initial auxiliary context creation now inherits creator/opener state; opening still needs activation, feature setup, and navigation. |
| Response enforcement | `BrowsingContext.enforceResponseOpenerPolicy()` carries both accumulated switch flags, URL, origin, policy, and navigation-source state through repeated response checks. It retains the first initial URL and requests navigation reports only when another context shares the group. |
| Navigation integration | The supplied-response path reserves the destination environment, parses its policies, and computes enforcement before creating the document. Existing prepared results are retained. The Fetch navigation loop must call enforcement at every redirect and supply its actual source state. |
| Group selection | Required switches create a new top-level context/group; report-only switches change only the virtual group identifier. Final sandbox flags are cloned. Old contexts remain available to history. Optional cross-site/browser-UI/singleton swaps are not taken. Nested destinations retain their context. |
| Isolation capability | same-origin-plus-COEP selects logical isolation. Agent clusters become origin-keyed, but the host does not provide physical isolation. The WindowOrWorkerGlobalScope crossOriginIsolated member now forwards the existing environment capability; logical isolation reports false. |
| Report URL sanitization | `sanitizeURLForReport()` copies the URL, removes credentials, and excludes the fragment without applying Fetch's different non-HTTP stripping rule. |
| Navigation reports | `queueNavigationToReport()` and `queueNavigationFromReport()` are explicit unfinished operations. They return for an absent disposition endpoint and otherwise throw for the missing URL-scoped Reporting queue. Body construction, disclosure rules, and delivery remain unfinished. |
| Access reports | `CrossOriginObjectBinding.checkAccessShouldBeReported()` filters declared cross-origin names, asserts fully active documents, rejects cross-origin ancestry, compares top-level virtual groups, and classifies opener relationships. Caller-bound WindowProxy Get/Set invoke it; automatic traps still need caller selection and integration. `OpenerPolicy.queueAccessReports()` explicitly retains the unfinished dispatcher and six body producers. |

Reporting dependencies are deliberately not routed through an arbitrary active
global. A response report can belong to an earlier redirect, a future document,
or a document that no longer owns a live global. Reporting must retain the URL's
endpoint configuration and lifetime, and accept that URL without rediscovering
an environment. COOP reports are not exposed to ReportingObserver.

Navigation-to bodies still need disposition, effectivePolicy, previousResponseURL,
referrer, and type. The previous URL is disclosed only for same-origin responses.
Navigation-from bodies need nextResponseURL, disclosed only for same-origin
responses or when the COOP response initiated the navigation. Referrer uses its
specified serialization; it is not replaced by a sanitized unrelated URL.

The access eligibility and relationship check was rechecked against
[published HTML](https://html.spec.whatwg.org/multipage/browsers.html#coop-check-access-report)
(26 October 2026) on 28 October. It uses the existing assembled cross-origin
annotations, including array-index recognition, without adding callbacks to the
environment or duplicating a permission table. Missing Window focus/blur declarations
remain an explicit limitation, covered by the existing annotation-completeness
expected failure. Symbols and non-reportable names return before context access.
The live inclusive ancestor chains use exact same-origin comparisons, independent
of document.domain and the serialized ancestor-origin snapshots. Virtual IDs,
opener relationships, policies, initial URLs, and referrers come from the top-level
contexts/documents; current URLs and origins come from the participating documents.

The check moved from a BrowsingContext stub to the caller binding, which supplies
the specification's environment argument. The dispatcher accepts
`OpenerPolicyAccessReportParams` plus that environment instead of fourteen separate
state arguments plus the environment. Both arrangements retain `SPEC_MISMATCH`
markers for review. Initial URLs and opener origins retain the nullable types of
the actual browsing-context slots; lifecycle producers and report disclosure still
need to account for those values. No substitute URL or origin is invented.

[Access-check tests](../../../../test/browlet/browsing/policy/coop-access.test.ts)
use real Window bindings, documents, and nested navigables, with the unfinished
dispatcher intercepted to inspect its inputs. All 35 cases initially failed at
the stub. They cover the early returns, activity assertion, ancestry on both sides,
live origin changes, virtual groups, relationships, and the complete input record.
They do not demonstrate automatic WindowProxy interception or emitted reports.

Caller-bound WindowProxy [Get](../window/ROADMAP.md#html-7237-caller-bound-property-reads)
and [Set](../window/ROADMAP.md#html-7238-caller-bound-property-writes) invoke this check
before property access, even for permitted child reads and rejected writes. Their
ordering tests intercept the unfinished dispatcher; automatic caller selection
and report delivery remain separate work.

The dispatcher must still produce both directions for opener, openee,
and unrelated-window accesses, applying the individual report algorithms' endpoint
and disclosure rules. The published dispatcher no longer contains the local
draft's unbound `coop` and `disposition` steps, so those obsolete steps are not
requirements for this implementation.
Body disclosure depends on current/initial URLs, opener origins at creation,
referrers, and exact same-origin checks. The accessing environment must supply
source URL, line, and column. Automatic ancestor navigation, creator/opener state,
WindowProxy/Location access interception, source-location capture, and URL-scoped
Reporting are still missing consumers/producers; none is treated as complete by
the policy comparison tests.

The sandbox/COOP network-error path remains a throwing dependency in navigation.
Failed preparation must eventually discard its reservation through the full
navigation lifecycle. COOP group changes do not establish WindowProxy cross-origin
security, opener severance across author-held references, or history disposal.

### Specification conflicts

- `SPEC_CLASH(coop-report-endpoint)`: the reporting algorithms always name the
  enforced endpoint, including for the reporting disposition, despite defining
  a separate report-only endpoint. Eric approved selecting the endpoint for each
  disposition. This agrees with WebKit's
  [`reportingEndpointForDisposition()`](https://github.com/WebKit/WebKit/blob/713192fabebfdd2955aa596c262c33bfbf3d50be/Source/WebCore/loader/CrossOriginOpenerPolicy.h)
  and its navigation-report callers. This is local source evidence, not a live
  browser delivery test.
- `SPEC_CLASH(coop-noopener-navigation)`: the noopener-allow-popups description
  says to force a new group regardless of the predecessor policy. The explicit
  ordinary-navigation algorithm instead allows matching same-origin values.
  Browlet follows that algorithm; initial-about:blank popup processing always
  switches for a noopener-allow-popups response.
- `SPEC_CLASH(coop-access-report-type)`: all six access-report body tables use
  access-to-opener, including operations headed access from an opener, access
  to/from an openee, and access to/from another window. The body type choice is
  pending review with access reporting; no fabricated type is emitted.

[COOP tests](../../../../test/browlet/browsing/policy/coop.test.ts) cover headers,
origin/policy comparisons, accumulated enforcement, navigation and virtual group
changes, logical isolation, endpoint selection, and URL sanitization. Reporting
calls in the enforcement test are intercepted to inspect their conditions; they
are not evidence of report-body generation or delivery.

## HTML 7.1.4 cross-origin embedder policies

Audited the complete [COEP section](https://html.spec.whatwg.org/multipage/browsers.html#coep),
including its preamble, headers, inheritance checks, and reports, against HTML
revision `9396777` above. The next Section 7 audit is §7.1.5, sandboxing.

| Requirement | Owner and result |
| --- | --- |
| Values and policy records | `EmbedderPolicy` has the three values and four defaulted fields. Its compatibility predicate accepts require-corp and credentialless. Policy-container cloning preserves both dispositions independently. |
| Fetch behavior | Fetch owns credentialless credential suppression and CORP enforcement/reporting, including the navigation flag. These remain distinct from HTML's inheritance check. The published Fetch algorithm now agrees with Browlet's same-origin redirect-taint check; the earlier clash is resolved. |
| Headers | `EmbedderPolicy.obtain()` gates on the supplied environment's secure-context status, parses each disposition as a structured item, and accepts report-to only as a string parameter of a compatible token. Unknown, unsafe-none, quoted, malformed, and list values do not retain endpoints. |
| Navigation inheritance | `Navigable.checkResponseEmbedderPolicy()` exempts top-level navigations and checks the container document's policies against the response's enforced value. Either compatible response value satisfies either compatible parent value; the response's report-only value does not. Supplied-response document creation calls the check before changing contexts or creating a document. |
| Worker inheritance | `WorkerGlobalScopeImpl` owns the embedder policy and common scripting state. Its check exempts non-dedicated workers; `DedicatedWorkerGlobalScopeImpl` checks the owner's two dispositions against its own enforced policy. Service-worker listener rules now inherit the common state. |
| Inheritance reporting | `queueCOEPInheritanceViolation()` uses Fetch's sanitized original response URL and the selected owner environment. Report-only precedes enforce, each with its own endpoint. Empty endpoints still reach local observers. |
| Observer bodies | Inheritance reports contain type, blockedURL, and disposition. A separate hidden `COEPInheritanceViolationReportBody` projects those fields without CORP's destination; existing CORP bodies retain it. This follows the reviewed Reporting interface model and WebKit's separate inheritance body. |

The checks are implemented; their remaining lifecycle consumers are explicit:

- **Navigation:** iframe/object/frame content-navigable setters now retain the
  reverse container association; child creation/destruction must populate it. Use that element's
  current node document, including after adoption, rather than the parent's active
  document or the element's creation environment. The Fetch-backed navigation loop
  must perform its CORP/inheritance checks and turn rejection into a network error.
  The supplied-response path currently throws at that unfinished error-document
  boundary. Child permissions policy and local/history policy selection remain
  separate navigation dependencies.
- **Workers:** the abstract globals have no startup, settings construction, or
  platform projection. Startup must obtain the response's embedder policy, assign
  it to the global, and call the dedicated-worker check with the outside settings
  before executing script. A false result requires network-error and worker-discard
  processing; adding the policy method does not implement that processing.
- **HTML's credentialless recommendation:** the preamble strongly encourages
  Private Network Access and Opaque Response Blocking. These separate proposals
  are not integrated into the published Fetch Standard, and Browlet implements
  neither pipeline. Their independent audits are recorded as an
  [HTML follow-up](../../../fetch/ROADMAP.md#html-credentialless-follow-up),
  separate from the earlier Fetch audit's known unfinished algorithms.
  Browlet's logical isolation continues to grant no cross-origin-isolated capability.

[COEP tests](../../../../test/browlet/browsing/policy/coep.test.ts) cover the header
matrix, both inheritance operations, disposition ordering/endpoints, current
container-document ownership, the blocked-document boundary, original-URL
sanitization, and local reporting with outbound delivery disabled. Worker tests
use concrete test subclasses of the partial globals; navigation tests connect real
container associations without automatic child creation. These are not worker-startup or iframe
conformance tests. [Observer tests](../../../../test/browlet/reporting/observers.test.ts)
exercise real projection and retain the regression for the unwanted destination
member; Fetch's [embedder tests](../../../../test/fetch/policy/embedder.test.ts)
cover credential suppression and CORP.

## HTML 7.1.5 sandboxing

Audited the complete [sandboxing section](https://html.spec.whatwg.org/multipage/browsers.html#sandboxing),
including every flag description, token exception, and state owner, against HTML
[`9396777`](https://github.com/whatwg/html/tree/939677714df7379fee3667040113b41c91c851e7)
(26 October 2026). Parsing all sixteen flags does not implement all their consumers.

| Requirement | Owner and result |
| --- | --- |
| Directive parsing | `SandboxingFlagSet.parse()` already covers all sixteen flags, ASCII whitespace/case, unknown tokens, activation distinctions, and the three custom-protocol exceptions. It returns a fresh set rather than taking an output set, as previously reviewed. |
| Iframe flag set | `HTMLIFrameElementImpl.sandboxingFlagSet` follows null-namespace sandbox attribute creation, mutation, and removal. Absence means no restrictions; an empty attribute means all restrictions. The projected `sandbox` DOMTokenList remains §4.8.5 work. |
| Popup and active-document sets | Contexts start with an empty popup set; Documents retain independent active-flag snapshots. Later iframe attribute changes do not alter an existing document's flags. New-target selection copies popup restrictions after context creation; subsequent navigation must consume them. |
| Permitted navigator | `BrowsingContext.onePermittedSandboxedNavigator` starts null. New-target selection records the sandboxed creator, including noopener; navigation permission consumes it independently of the mutable opener. See the [§7.4.2.4 audit](../navigation/ROADMAP.md#html-7424-sandbox-navigation-permission) for the approved conflicts. |
| CSP-derived restrictions | Existing `CSPList.getSandboxingFlags()` unions enforced header policies and ignores reporting/meta policies. Keep the reviewed `SPEC_CLASH(csp-sandbox-combination)`: HTML currently retains only the last directive, whereas Browlet and all three reference engines combine restrictions. Evidence remains in the [CSP audit](csp/ROADMAP.md#retained-specification-decisions). |
| Creation flags | `BrowsingContext.determineCreationSandboxingFlags()` copies popup flags without an embedder; with an iframe, it unions the iframe's flags and its current node Document's active flags. Child creation does not inherit the context's popup set separately. Object/frame response preparation throws pending a sandbox inheritance audit: HTML's element case asks for an iframe flag set not defined on those elements. |
| Supplied-response navigation | `createNavigationParams()` combines creation flags and response CSP before selecting an opaque origin, then document creation copies the final set. Full navigation still needs source/target snapshots and the inline-srcdoc path's inherited-CSP ordering. |

Every flag's remaining enforcement owner is explicit:

| Flags | Existing behavior or remaining consumer |
| --- | --- |
| navigation; auxiliary navigation; top-level navigation with/without activation; custom-protocol navigation | Target selection checks auxiliary restrictions; navigation admission and named lookup use the §7.4.2.4 sandbox predicate with captured activation/flags and the permitted creator. Activation notification/expiry, history-application callers, and Window.close remain unfinished. The §7.4.2.3.4 external-handoff gate consumes captured target flags/source activation; handler selection and the host handoff still throw explicitly. `isNavigationOrHistoryUpdateBlocked()` is the separate implementation-defined throttle. |
| origin | Context/response preparation can select an opaque origin. Initial iframe and auxiliary creation inherit creator origin/base/cookie state. Source capture for later about:blank/srcdoc navigation remains unfinished. |
| forms; pointer lock | Form submission and pointer-lock entry points must apply their flags. |
| scripts; automatic features | The environment's scripting predicate reads the scripts flag. Parser/script preparation, automatic media playback, and autofocus still need their owning consumers; parsing the automatic-features flag does not enforce them. |
| document.domain | The Document setter rejects the flag before domain relaxation. |
| propagation to auxiliary contexts | New-target selection copies restrictions unless the source permits escape; subsequent navigation must consume the context's popup flag set. |
| modals; orientation lock; presentation; downloads | Dialogs/beforeunload, orientation, Presentation API, and both navigation/hyperlink downloads need their checks. |

[Sandbox tests](../../../../test/browlet/browsing/policy/sandbox.test.ts) cover
tokens, attribute mutation/cloning, independent snapshots, adopted iframe
ownership, and response preparation. The last test supplies only the unfinished
container association; it does not claim working child navigation.

## HTML 7.1.6 iframe element referrer policy

Audited [the complete algorithm](https://html.spec.whatwg.org/multipage/browsers.html#the-iframe-element-referrer-policy)
at the same HTML revision. `HTMLIFrameElementImpl.determineReferrerPolicy()`
returns the canonical referrerpolicy attribute state for an iframe and the empty
string for a non-iframe or null. The real `referrerPolicy` IDL member uses the
existing shared enumerated-attribute binding, including empty/invalid defaults.
Browsing-context initialization and response preparation now supply this value
to Document ancestry initialization. It is distinct from the destination's
response Referrer-Policy header.

The actual child/container association, iframe request construction, and srcdoc
load lifecycle remain unfinished. [Reflection tests](../../../../test/browlet/dom/nodes/html/referrer-policy.test.ts)
exercise the projected member; sandbox/navigation tests check capture before
later attribute mutations. Existing ancestry tests retain their separate
loaded-srcdoc expected failure.

## HTML 7.1.7 policy containers

Audited [all container fields and algorithms](https://html.spec.whatwg.org/multipage/browsers.html#policy-containers)
at the same HTML revision.

| Requirement | Owner and result |
| --- | --- |
| Defaults and cloning | Containers retain CSP, COEP, referrer, enforced integrity, and report-only integrity state. Cloning preserves CSP self origin and copies policies independently. A not-yet-associated container still represents the empty CSP list as `undefined`: `CSPList` currently requires a self origin. An origin-independent empty-list representation remains CSP owner work; do not invent an opaque origin as a default. |
| Response creation | `UserAgent.createPolicyContainerFromResponse()` composes CSP, COEP, referrer, and both integrity parsers. This factory lives beside the existing browser policy allocator because it also consumes browser-owned Blob entries and permits a null environment. |
| Blob responses | Clone the retained Blob entry creator environment's current policy container. Do not re-resolve the store after revocation or overwrite inherited policies with response headers. `BlobURLEnvironment` now explicitly requires its existing creator's policy container. |
| History predicate | `PolicyContainer.requiresStorageInHistory()` accepts local non-Blob URLs. Supplied-response history entries retain the live container; reconstruction selects a clone so subsequent document mutations are retained without sharing the reconstructed copy. |
| Navigation selection | `PolicyContainer.determineForNavigation()` implements history, srcdoc parent, local initiator, response, and fresh-default precedence. History and inherited state are cloned; a response container retains identity. Assertions reject invalid history URLs or missing srcdoc parents. |
| Response association | Supplied-response navigation now installs Referrer-Policy and both integrity headers along with existing CSP/COEP. COEP completion waits for the reserved environment's security decision and preserves Blob creator policy. Regressions exposed both the lost no-referrer header and Fetch's missing default for an empty container policy; both are fixed. |
| Worker initialization | `WorkerGlobalScopeImpl.initializePolicyContainer()` clones the sole owner for local non-Blob URLs and uses response creation otherwise. URL, owner set, and policy container are explicit on the partial global. Worker owners contribute their own policies, including for nested workers. §10 startup must populate the URL/owners and call this operation; IDL and startup remain deferred. |

Two continuing specification conflicts are recorded in code:

- `SPEC_CLASH(policy-container-null-environment)`: HTML assigns the string
  unsafe-none to a field defined to contain an embedder-policy record. Browlet
  retains the fresh default record, including report-only state and endpoints.
- `SPEC_CLASH(policy-container-report-only-integrity)`: HTML defines report-only
  integrity state but omits it from cloning. Preserve Browlet's existing copy of
  both dispositions. Gecko's `PolicyContainer::InitFromOther()` delegates to
  [`IntegrityPolicy::InitFromOther()`](https://searchfox.org/firefox-main/source/dom/security/IntegrityPolicy.cpp),
  which copies enforced and report-only entries; this is source evidence, not a
  newly run browser probe.

The supplied-response path represents browser-UI navigation, with no initiator or
history restoration. Full §7.4 navigation must capture source/target policies,
feed retained history state into selection, and implement inline srcdoc ordering.
Initial blank creation now clones the creator's container. History reconstruction,
worker startup, and worklet policy association remain lifecycle work. Do not infer those integrations
from the standalone selection tests. [Container tests](../../../../test/browlet/browsing/policy/container.test.ts)
cover precedence, copy/identity rules, all response fields, Blob revocation, and
history retention; [worker tests](../../../../test/browlet/workers/policy-container.test.ts)
cover document/nested-worker ownership and the Blob exception without worker startup.

This pass stops before §7.2.

## Permissions Policy

[Permissions Policy](https://w3c.github.io/webappsec-permissions-policy/) is owned
by [permissions.ts](permissions.ts), alongside Browlet's other browsing policies.
It controls feature availability in Documents; the separate
[Permissions Standard](../../../permissions/ROADMAP.md) owns user consent.

Reviewed against the 26 October 2026 draft, source revision
[`81e7009`](https://github.com/w3c/webappsec-permissions-policy/tree/81e7009cd714acc2efff79bc028ef990cdb9bf44).
The local `w3c-permissions-policy` checkout was fast-forwarded to this revision.
The document-order pass is complete through §13. The framework algorithms,
inspection bindings, and reporting producers exist; the remaining integrations
below still limit browser-level coverage. Recorded specification/browser clashes
remain deliberate choices to revisit when the sources converge.

### §§1–3: introduction, examples, and related mechanisms

These sections introduce header restrictions, delegation to selected frames,
and the relationship to sandboxing. They add no independent runtime algorithms.
The examples are future integration cases, not current conformance claims.
Allowing a feature through policy does not grant user permission, and this policy
does not replace iframe or CSP sandbox restrictions.

### §§4.1–4.2: features and policy state

The policy module indexes Browlet's supported feature definitions by their unique
tokens. This fixed catalog is shared across browser instances. The initial entry
is HTML's `cross-origin-isolated`, whose default allowlist is `self`. Fetch's
`deferred-fetch` (`self`) and `deferred-fetch-minimal` (`*`) now support navigation
quota reservation and Document accounting. Their registration also makes them
visible in policy inspection and potential-violation reporting; it does not
expose the unfinished `fetchLater()` API. See the
[quota audit](../navigation/ROADMAP.md#deferred-fetch-quota-at-navigation).
Future feature owners must add their definitions when their consumers exist.

Each `PermissionsPolicy` owns its inherited feature values and a declared-policy
record containing declarations and reporting configuration. An empty policy has
an `Enabled` inherited entry for every supported feature and empty declaration
and reporting maps. This does not itself decide whether a feature may be used.

Initial about:blank, detached Documents, and the existing top-level response path
use the same catalog through `new PermissionsPolicy()` and
`PermissionsPolicy.create(embedder, origin)`. Each policy owns its mutable maps;
sharing feature definitions does not share per-Document restrictions.

The public §7 `PermissionsPolicy` inspection object is separate from this internal
record; its initial implementation is described below.

### §§4.3–4.8: policy relationships and allowlists

§§4.3–4.6 define the relationships between inherited state, response declarations,
and container directives. The existing records hold inherited values and declared
allowlists. §§9.5–9.7 combine container inheritance with response declarations.

`PermissionsPolicyAllowlist.matches(origin)` implements §4.7. The class represents
the policy wildcard with `matchesAllOrigins`; otherwise it uses its expressions
and captured origins. Captured `self` and `src` origins use HTML's same
origin-domain comparison, including opaque identity. Other opaque origins fail;
scheme/host expressions use the existing CSP matcher against the serialized
origin with redirect count zero. CSP's documented source-matching choices remain
in [its roadmap](csp/ROADMAP.md). Parsing must resolve keywords and admit only
scheme/host expressions before calling this matcher.

§4.8's `*` and `self` defaults are represented in feature definitions and applied
by §§9.7–9.9. Explicit allowlist matching alone does not enable a feature or
enforce a Document policy.

### §5.1: attribute syntax and §9.3 parsing

`PermissionsPolicy.parseDirective(value, containerOrigin, targetOrigin?)` parses
an `allow` value into a fresh directive map. It ignores unsupported feature names,
keeps the first declaration for each supported feature, resolves `self`/`src`,
and defaults a bare feature name to the supplied target origin. Without a target
origin, a bare name or `src` grants nothing. The wildcard dominates other entries;
invalid entries do not discard valid siblings or trigger the bare-name default.

URL entries are parsed and stored as unique serialized origins. Blob URLs,
credentials, and opaque URL origins are ignored. This is the parser's recovery
behavior, which §5.1 explicitly allows to accept more than its authoring grammar.

`SPEC_CLASH(permissions-policy-attribute-ascii)`: §9.3 uses the URL parser, so
Browlet accepts and canonicalizes internationalized hostnames. Chromium's
[`ParseAllowlist()` source at 1136757f](https://github.com/chromium/chromium/blob/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/core/permissions_policy/permissions_policy_parser.cc#L249)
rejects non-ASCII input first. A 31 October 2026 Playwright probe confirmed:

| Engine | `https://bücher.test` | `https://xn--bcher-kva.test` |
| --- | --- | --- |
| Chromium 156.0.8078.4 | Ignored | Accepted |
| Firefox 157.0 | Accepted | Accepted |
| WebKit 27.2 | Accepted | Accepted |

The probe used a parent at `https://parent.test`, a cross-origin iframe at the
ASCII hostname, and `allow="fullscreen <origin>"`. It read the child's
`document.fullscreenEnabled`; `fullscreen 'none'` denied and `fullscreen *`
allowed in all three engines. All responses were supplied locally. Keep the
draft's URL normalization, also observed in Firefox and WebKit; §5.1 explicitly
permits its parsing algorithm to recover input outside the authoring grammar.

The parser takes origins explicitly. Iframe attribute processing supplies them
as described below; deriving the child Document's inherited policy remains later
integration work.

### §§5.2 / 6.1: header syntax and §§9.1–9.2 parsing

`DeclaredPermissionsPolicy.fromResponse(response, origin, reportOnly)` uses
Fetch's Structured Fields parser for the selected response header. Its
`fromDictionary(dictionary, origin)` factory interprets supported features,
scheme/host source strings, `self` and `*` tokens, inner lists, and token-valued
`report-to` parameters. Repeated fields are combined; duplicate feature names
use the last dictionary member, unlike the attribute parser's first-wins rule.
Strings retain their source-expression syntax, including wildcards and paths.
The Structured Fields parser rejects non-ASCII headers; internationalized
hostnames must use their ASCII serialization here.

Two draft conflicts are explicit:

- `SPEC_CLASH(permissions-policy-empty-response)`: §9.1 returns an empty map for
  absent or malformed headers, although its result is a declared policy. Return
  a record with both maps empty, as required by the surrounding policy model.
- `SPEC_CLASH(permissions-policy-header-values)`: §5.2 allows a single source
  string and requires an invalid member to be discarded; §9.2 omits both rules.
  Follow §5.2. An invalid member loses its reporting parameter too. Invalid items
  inside a valid inner list are ignored; an empty list remains an explicit
  empty allowlist.

Chromium's [header parser at 1136757f](https://github.com/chromium/chromium/blob/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/core/permissions_policy/permissions_policy_parser.cc#L461)
accepts single strings, but retains an empty allowlist for invalid member values.
A 31 October 2026 probe read `document.fullscreenEnabled` on locally supplied
HTTPS responses in three Playwright engines:

| `Permissions-Policy` value | Chromium 156.0.8078.4 | Firefox 157.0 | WebKit 27.2 |
| --- | --- | --- | --- |
| No header | Allowed | Allowed | Allowed |
| `fullscreen=()` | Denied | Allowed | Allowed |
| `fullscreen="https://other.test"` | Denied | Allowed | Allowed |
| `fullscreen=?1` or `fullscreen=unknown` | Denied | Allowed | Allowed |
| `fullscreen="not a source"` | Denied | Allowed | Allowed |
| `fullscreen=(` (malformed Structured Field) | Allowed | Allowed | Allowed |

Firefox and WebKit do not enforce this response header in these builds, including
the valid deny-all control. Their results are not evidence for either invalid-value
interpretation. Their header implementation trackers remain open:
[Firefox #1694922](https://bugzilla.mozilla.org/show_bug.cgi?id=1694922) and
[WebKit #253126](https://bugs.webkit.org/show_bug.cgi?id=253126).

The exact prose/algorithm conflict is already tracked in [specification issue
#527](https://github.com/w3c/webappsec-permissions-policy/issues/527), still open
without a resolution. Its reporter proposes the Chromium/algorithm behavior.
The earlier [error-recovery discussion](https://github.com/w3c/webappsec-permissions-policy/issues/39#issuecomment-289525394)
explicitly chose to ignore unparsable allowlists for forward compatibility. That
discussion concerned the former JSON syntax; it supports the reasoning behind
§5.2 but does not resolve the current Structured Fields conflict. Browlet currently
keeps §5.2's explicit rule. These probes do not establish Browlet fullscreen or
Document policy enforcement.

Both header dispositions can be parsed independently. Attaching those records
to Documents, combining inherited restrictions, evaluating features, and sending
reports remain later work; response navigation retains its explicit guard.

### §§6.2–6.3: iframe attributes and §9.4 processing

`HTMLIFrameElement.allow` and `allowFullscreen` use the existing string/boolean
reflection bindings. `HTMLIFrameElementImpl.processPolicyAttributes()` reads a
fresh `PermissionsPolicyDirective` map from the iframe's current null-namespace
attributes, node Document origin, and `declaredOrigin`. `ElementImpl` supplies
the empty-map default for other elements.
Mutations and adoption affect subsequent processing without changing a previously
returned map or an existing Document's policy. Navigation must call this boundary
when selecting a child policy; iframe lifecycle and feature inheritance remain
unfinished.

The iframe's `declaredOrigin` getter supplies the §7 dependency: parent and iframe
sandbox restrictions take precedence, then `srcdoc`, then Document-relative `src`
parsing, falling back to the node Document origin when `src` is missing or invalid.
Sandboxed results are fresh opaque origins as specified; this helper does not
substitute them for the actual origin of a subsequently loaded child.

`SPEC_CLASH(permissions-policy-blank-origin)`: the draft takes the URL origin even
for explicit `about:blank`, which is opaque. Chromium's
[`MakeOriginForPermissionsPolicy()`](https://github.com/chromium/chromium/blob/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/core/html/html_frame_element_base.cc#L155)
instead uses the parent's origin for URLs whose Documents inherit it. A 31 October
2026 probe loaded `src="about:blank"` with `allow="fullscreen 'src'"`: Chromium
156.0.8078.4 and WebKit 27.2 enabled fullscreen, while Firefox 157.0 denied it.
The `'none'` control denied in all three. Keep the draft's origin rule here,
consistent with Firefox's observed result; no browser-wide agreement is claimed.

The `allowfullscreen` wildcard fallback is conditional on a supported Fullscreen
feature and never overwrites an explicit parsed directive. **Fullscreen is not
implemented or registered**, so this fallback is currently inactive and its
precedence tests remain a Fullscreen dependency. Reflection alone does not
advertise support. Custom-element reaction delivery remains the existing
`CEReactions` dependency.

### §§7.1–7.2: inspection objects and supported features

The overview distinguishes a Document's policy from the policy observable through
an iframe. The latter must use the embedding Document and the iframe's attributes,
without exposing restrictions or navigation inside a loaded cross-origin child.

[`PermissionsPolicyImpl`](permissions-policy.ts) retains its associated Document
or iframe. Each owner lazily supplies one `permissionsPolicy` object; separate
Web IDL partials expose it as the `[SameObject] permissionsPolicy` attribute.
The Document's internal record is named `permissionsPolicyState`. Replacing that
record does not replace the inspection object.

`features()` returns a fresh sequence of supported feature names, in catalog
order, regardless of policy restrictions. Binding owns the returned JavaScript
array and platform-object branding. The API is exposed on Window without a secure
context requirement or author constructor. Its internal `defaultOrigin` getter
reads the associated node each time, so iframe adoption and attribute changes do
not leave a captured origin behind. Adoption preserves the iframe's original
environment and inspection-object identity; a new Document after navigation has
its own object.

### §7.2 allowsFeature() and §§9.7–9.9 query dependencies

`allowsFeature()` checks the current observable policy. A Document supplies its
current `permissionsPolicyState`; an iframe derives a fresh inherited map from
its embedding Document and current attributes, with empty declared/reporting
maps. The iframe query never reads its loaded child's policy or actual location.
Attribute mutations, adoption, and replacement of the parent policy affect the
next query without replacing the public inspection object.

`PermissionsPolicy.getInheritedValue()` implements §9.7. The embedding policy
must permit both its own origin and the intended child's origin before the
container allowlist or feature default can enable delegation. Document's
`getPolicyFeatureValue()` implements §9.8 and selects enforced or report-only
state; unlike a final policy check, it does not apply a default allowlist.
`PermissionsPolicy.check()` implements §9.9: inherited denial takes precedence,
then explicit declarations, then the feature default. Default `self` uses strict
same-origin comparison; explicit allowlists keep §4.7's origin-domain matching.

Document allocates an independent empty `reportOnlyPermissionsPolicyState`;
response initialization replaces it through §§9.6/10.1. Inspection uses only the
enforced policy and does not report feature use. Actual-use checks and reports
are separate Document operations, described under §9.10 below.

`SPEC_GAP(permissions-policy-origin-argument)`: §7.2 accepts a DOMString origin
without specifying its conversion to an origin record or invalid-input handling.
Follow Chromium's [explicit-origin overload at 1136757f](https://github.com/chromium/chromium/blob/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/core/permissions_policy/dom_feature_policy.cc#L51):
parse an absolute URL without a base, extract its origin, and return false for
invalid or opaque results. An omitted argument uses the actual default origin,
which may be opaque; unknown feature names return false.

A 31 October 2026 probe used Chromium 156.0.8078.4's legacy `featurePolicy` name
on an HTTPS Document with `Permissions-Policy: fullscreen=*`. Absolute URLs with
paths, credentials, canonicalized default ports, other origins, and a blob URL
with an HTTPS origin returned true. Empty/relative/invalid inputs, `about:blank`,
`data:`, and the string `null` returned false. Omission and explicit `undefined`
both used the default origin. Firefox 157.0 and WebKit 27.2 exposed neither
inspection property, so no equivalent live result is claimed for those engines.

### §7.2 allowedFeatures()

`allowedFeatures()` captures the default origin and observable policy once,
then returns supported feature names whose policy check succeeds at that origin.
Unlike `features()`, this list reflects current enforced restrictions; it ignores
report-only declarations. Binding projects a fresh Array on each call, so earlier
results remain snapshots after attribute changes, adoption, or policy replacement.
This operation adds no dependencies beyond the existing query checks.

### §7.2 getAllowlistForFeature()

`getAllowlistForFeature()` returns a fresh sequence for a supported feature
permitted at the current default origin: `*`, serialized captured origins, or
the declared source expressions. Unknown or denied features return an empty
sequence. It shares the existing observable-policy and checking algorithms.
Iframe inspection still does not read a loaded child's policy or location.

- `SPEC_GAP(permissions-policy-allowlist-default)`: step 5 assumes a declaration
  exists and reverses the declared-policy/declarations lookup. Use the actual
  declarations map; when absent, use the feature default (`*` or the serialized
  default origin). Both [Chromium's policy implementation](https://github.com/chromium/chromium/blob/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/services/network/public/cpp/permissions_policy/permissions_policy.cc)
  and [Gecko's inspection method](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/dom/security/featurepolicy/FeaturePolicy.cpp#L286)
  supply that fallback.
- `SPEC_CLASH(permissions-policy-iframe-allowlist)`: keep the draft's observable
  iframe policy with empty declarations, so a permitted feature uses its default.
  Chromium agrees; Gecko inspects the container declaration instead. For a
  default-self feature with a wildcard `allow` directive, Browlet and Chromium
  return the intended iframe origin while Gecko returns `*`.
- `SPEC_CLASH(permissions-policy-allowlist-denied-origin)`: keep the draft's
  explicit step 4 gate, also present in Gecko's source. Chromium instead exposes
  a declared allowlist permitting only foreign origins even when `allowsFeature()`
  is false at the default origin. Browlet returns an empty sequence in that case.
- `SPEC_CLASH(permissions-policy-allowlist-opaque)`: for default `self`, use HTML
  origin serialization (`null`) even for an opaque origin. Chromium drops that
  default-origin entry; Gecko exposes an internal `moz-nullprincipal:` string.
  The result conveys no opaque-origin identity and cannot be used as an
  equivalent explicit origin argument to `allowsFeature()`.

On 31 October 2026, Chromium 156.0.8078.4 confirmed the default fallback and both
disagreements above. A cross-origin iframe with `allow="fullscreen *"` reported
its intended origin, not `*`, matching the empty-declaration observable policy.
Firefox 157.0 and WebKit 27.2 exposed no inspection API by default. A temporary
Firefox profile with `dom.security.featurePolicy.webidl.enabled` enabled its
legacy API: default `self` returned the document origin, iframe wildcard
inspection returned `*`, and an opaque document exposed the principal string.
Legacy response headers did not affect that probe even with
`dom.security.featurePolicy.header.enabled`; the Gecko default-origin gate is
source evidence, not a verified response-header result.

Serialization preserves the draft's self-before-src ordering, including
duplicates, and its literal src-or-expressions branch. Response declarations
currently never populate src-origin; tests supply that record explicitly.
Child navigation and feature-use reporting remain separate consumers.

### §8: report bodies and shared Reporting

[`PermissionsPolicyViolationReportBodyImpl`](permissions-policy-report.ts) snapshots
the seven §8 fields. Shared Reporting projects it for both
`permissions-policy-violation` and §9.14's `potential-permissions-policy-violation`.
Both types support observer filtering, task delivery, buffered replay, and outbound
serialization. Disabling network delivery leaves local observation available.
This connects supplied report data, not feature-use or iframe-load detection.

- `SPEC_CLASH(permissions-policy-report-interface)`: follow the draft's Window
  interface, signed nullable coordinates, and `[Default] toJSON()`. Chromium's
  [IDL](https://github.com/chromium/chromium/blob/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/core/frame/permissions_policy_violation_report_body.idl)
  hides the interface object, uses unsigned coordinates, and adds `message`.
  Gecko retains the pref-gated legacy
  [`FeaturePolicyViolationReportBody`](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/dom/webidl/FeaturePolicy.webidl).
  Chromium exposed the interfaces in 2022, then [reverted the group in February
  2023](https://github.com/chromium/chromium/commit/292435cd87cf428066d403e78df42fa237cc374b)
  because the global `Report` name broke SAP BusinessObjects pages. That is not
  evidence of a collision with this specific interface. Browlet already hides
  `Report`. The [interface-to-dictionary discussion](https://github.com/w3c/reporting/issues/216)
  remains unresolved across specs and engines; in March 2026, Gecko explicitly
  retained interfaces for compatibility. Keep the existing Reporting body model.
- `SPEC_CLASH(permissions-policy-report-optional-fields)`: §8 says iframe fields
  are omitted outside potential reports, but its default Web IDL serializer
  includes every declared attribute. Preserve omission in the producer payload
  used for outbound delivery; observer getters and `toJSON()` expose null.
  Potential payloads preserve supplied nulls, empty strings, and relative `src`
  text. Chromium's [custom serializer](https://github.com/chromium/chromium/blob/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/core/frame/permissions_policy_violation_report_body.cc)
  omits empty iframe strings from JSON instead. Its [2019 implementation](https://github.com/chromium/chromium/commit/6a93b00b6a91aeec4fb336e8eec12198e0aff2c1)
  fixed `JSON.stringify(report.body)` producing `{}` for inherited getters,
  predating [Permissions Policy's 2024 toJSON addition](https://github.com/w3c/webappsec-permissions-policy/pull/472).
  The history does not explain the later choice to omit empty iframe strings.

On 31 October 2026, a blocked-fullscreen probe in Chromium 156.0.8078.4 confirmed
the hidden interface, extra `message`, and omitted iframe JSON fields. Firefox
157.0 and WebKit 27.2 exposed ReportingObserver but no modern report-body
constructor and produced no matching report in that probe; this does not establish
their general reporting support or successful header enforcement.

§8.1's report-only header uses the shared §9.1/§9.2 parser and is installed during
response Document initialization. §9.10 now invokes the actual-violation producer;
potential iframe checks/producers exist but await §10's iframe-load integration.

### §9.5: create a policy for a navigable

`PermissionsPolicy.create(container, origin)` captures each supported feature's
inherited value through §9.7. Top-level destinations start enabled; embedded
destinations combine the parent's enforced restrictions, current container
attributes, and supplied destination origin. The new policy's declarations and
reporting configuration remain empty. Later parent or attribute changes do not
rewrite an already-created policy.

Iframe inspection reuses this factory with the current declared origin on every
query. Creation can instead use a different destination origin, such as after a
redirect. [Creation tests](../../../../test/browlet/browsing/policy/permissions-creation.test.ts)
cover delegation, parent restrictions, destination-origin changes, independent
policy state, and denial through nested supplied Documents. They do not simulate
iframe loading. Initial iframe context creation now applies those inherited
policies; automatic element loading and child history application remain unfinished.

### §9.6: response policy creation and §10.1 Document initialization

`PermissionsPolicy.fromResponse(container, origin, response, reportOnly?)` starts
with §9.5 inheritance, adds response declarations only for inherited-enabled
features, and retains all parsed endpoint names. Selecting the report-only header
does not change which parent policy supplies inheritance: §9.6 calls §9.5 without
a report-only flag. A response cannot re-enable a feature denied by an ancestor.

`SPEC_CLASH(permissions-policy-response-record)`: §9.6 tests inherited values
against boolean `true`, while §4.2 defines `Enabled`/`Disabled`. It also indexes
reporting configuration through an out-of-scope feature, although that map belongs
to the declared-policy record. Use §4.2's enum value and record shape. Chromium's
[policy construction](https://github.com/chromium/chromium/blob/1c9716f07802cb68ee0f5cef54ecf186346eebdd/services/network/public/cpp/permissions_policy/permissions_policy.cc)
also stores reporting endpoints separately from inherited availability. It keeps
header allowlists even for inherited-disabled features but checks inherited denial
first; Browlet retains §9.6's filtering, with the same effective denial.

The existing supplied-response Document path installs independent enforced and
report-only results, including §10.1's initialization amendment. Tests cover both
dispositions, missing/invalid headers, opaque destination origins, inherited denial,
endpoint retention, supplied child containers, and policy replacement on navigation.
Inspection remains independent of feature-use enforcement and report production.

### §§9.10–9.11 and 9.13: feature use and actual violation reports

`Document.isPolicyFeatureEnabled(feature, origin, report = true)` checks both
policies and returns the enforced result. Enforced denial queues one `enforce`
report; otherwise report-only denial queues one `report` report without blocking
use. Passing `false` suppresses reporting; the §7 inspection API also remains
silent. `PermissionsPolicy.getReportingEndpoint()` selects the corresponding
policy's feature endpoint, or null.

HTML's `Document.isAllowedToUse(name)` retains its no-context/full-activity gates
and resolves the feature name through the supported catalog before checking its
own origin. The existing string boundary is shared with the Permissions adapter;
the specification takes a feature record.
An unregistered consumer remains an explicit error: its defining specification
must supply a feature and default allowlist. Concrete-isolation capability now
uses this result rather than stopping at a Permissions Policy stub.

`env.reportPermissionsPolicyViolation()` forwards to this module's producer,
which builds the raw payload for the existing Reporting pipeline. The report-body
class only retains the observer-facing data. Missing endpoints use Reporting's empty
destination, preserving local observation without selecting a default network
endpoint. Empty names cannot occur in a parsed Reporting-Endpoints dictionary.
Script coordinates stay null: §9.13 makes extraction conditional on availability,
and the engine does not yet expose that facility. Actual reports omit iframe
attributes in their outbound payload as required by §8.

`SPEC_CLASH(permissions-policy-report-disposition)`: §§9.10/9.12 supply `Enforce` and
`Report`, while §8 defines `enforce` and `report`. Use §8's lowercase values,
matching Chromium's
[actual report producer](https://github.com/chromium/chromium/blob/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/core/frame/local_dom_window.cc#L674).

[Feature-use tests](../../../../test/browlet/browsing/policy/permissions-enforcement.test.ts)
cover response-installed policies, all enforced/report-only outcomes, silent
queries, inherited denial, default-origin checks, report destinations, observer
delivery without an endpoint or outbound permission, and activity gates. Existing
Window settings tests now exercise the implemented concrete-isolation policy query.

### §§9.12 and 9.14: potential iframe violations

`HTMLIFrameElementImpl.checkPotentialPermissionsPolicyViolation(allowAttribute,
srcAttribute)` checks each supported feature at the iframe's current declared
origin. Enforced inherited denial wins; otherwise report-only inherited denial
produces a `report` disposition. Endpoint selection follows the corresponding
policy on the iframe's current node Document. Reporting uses that Document's
environment, including after adoption; it does not read the loaded child's policy.

The environment forwards to the potential-report producer in
`permissions-policy-report.ts`. The report retains both supplied attribute values
verbatim, including null, empty strings, and relative URLs. Actual and potential
reports use distinct types; source-location extraction remains optional and
unimplemented for both.

Two source-level differences were confirmed in Chromium's current
[iframe checker](https://github.com/chromium/chromium/blob/2ae93f9b43b9bb8d54e382a9257ef950feaa308c/third_party/blink/renderer/core/html/html_iframe_element.cc)
on 31 October 2026:

- `SPEC_CLASH(permissions-policy-potential-features)`: §9.12 checks all supported
  features, while Chromium skips empty `allow` and features not declared there.
  Follow the draft: default and inherited restrictions can produce potential
  reports even without an explicit delegation attempt. This can be noisier than
  Chromium; no runtime equivalence is claimed.
- `SPEC_CLASH(permissions-policy-potential-endpoint)`: Chromium's report-only
  branch reads the enforced policy's endpoint. Follow §9.12, which selects the
  report-only endpoint; tests use distinct names to preserve that distinction.

**Integration boundary:** [§10.1](#101-html-integration) needs the unfinished
iframe load event steps. The checker is implemented and tested directly;
attribute changes, insertion, and arbitrary author-dispatched events do not invoke it.

[Potential-report tests](../../../../test/browlet/browsing/policy/permissions-potential.test.ts)
cover both dispositions, defaults, parent restrictions, endpoint selection,
src/srcdoc/sandbox inputs, raw attribute snapshots, observer delivery, adoption,
and independence from supplied child policy. They do not establish iframe loading.

### §9.15: request feature checks

`FetchRequest.isAllowedToUseFeature(name)` checks the request's initiating client,
returning false for null and non-Window clients. It passes the populated request
origin to `env.isPolicyFeatureEnabled()`, which resolves the supported definition
and invokes the client's associated Document's §9.10 check, including reporting.
Request owner, reserved client, and destination URL do not select the policy.
No fully-active gate is added: this algorithm differs from HTML's allowed-to-use
check, so a retained request still checks its original Document after navigation.

The callable takes a feature name instead of the specification's feature record
to keep Fetch independent of HTML policy types. Unsupported internal names fail
explicitly. As with Fetch's other origin-sensitive operations, callers must
first populate the request origin; the check does not resolve or mutate it.

**Consumer boundary:** Client Hints and other request features must register
their definitions and invoke this check. Ordinary fetches do not automatically
consume a policy-controlled feature, and this helper does not block network
requests. Worker/worklet clients remain denied as specified while their policy
model is unresolved. Tests use the existing `cross-origin-isolated` definition
to exercise the algorithm, not to impose an isolation requirement on Fetch.

[Request tests](../../../../test/browlet/browsing/policy/permissions-request.test.ts)
cover client/owner separation, resolved and opaque origins, redirects, inherited
denial, both report dispositions/endpoints, and retained clients after navigation.

### §10.1: HTML integration

The [draft's HTML amendments](https://w3c.github.io/webappsec-permissions-policy/#changes-to-html)
have two integration points:

| Amendment | Current implementation |
| --- | --- |
| Initialize each Document's report-only policy, then install the response-derived policy during creation | `DocumentImpl` owns an independent empty policy. `Navigable.createAndInitializeDocument()` derives the response policy from the actual container and origin and installs it before exposing the new Document. Covered by the policy initialization and response-creation tests. |
| Check potential violations after the iframe element's `load` event | The checker exists. `HTMLIFrameElementImpl.runLoadEventSteps()` explicitly throws and has its initial-insertion javascript: caller; flags/timing and ordinary loading callers remain unfinished. `DocumentImpl.finishLoading()` fires the child Window's event, which is a different completion point. |

The remaining [iframe load event steps](https://html.spec.whatwg.org/multipage/iframe-embed-object.html#iframe-load-event-steps)
must honor the child Document's mute flag, finish pending iframe resource timing,
and set its load-in-progress flag before dispatch. Insert the policy check after
dispatch returns and before clearing that flag. Read the element's raw `allow`
and `src` at that point, so synchronous load handlers' mutations are reflected.
The existing checker uses the element's then-current node Document after adoption.

HTML's [complete-loading algorithm](https://html.spec.whatwg.org/multipage/document-lifecycle.html#completely-finish-loading)
must queue those steps for an iframe container on the DOM manipulation task
source. Initial `about:blank` insertion has a separate synchronous caller in
iframe attribute processing. Child creation/destruction, attribute processing,
load flags, and pending resource timing remain HTML loading dependencies; no
load-event listener or direct checker call substitutes for those algorithms.

The existing [response-creation tests](../../../../test/browlet/browsing/policy/permissions-creation.test.ts)
cover supplied child containers, both response dispositions, replacement on
navigation, and report-only isolation from enforcement. The
[potential-report tests](../../../../test/browlet/browsing/policy/permissions-potential.test.ts)
cover reporting and adoption directly, not automatic child completion.

### §§11–13: registration, privacy/security, and change history

§11 requests IANA registration of the `Permissions-Policy` header, not a browser
operation. The response parser already consumes that header. §13 records history;
it introduces no additional API. Current algorithms already use same-origin
inheritance/default checks, restrictive header/container composition, and
Structured Fields. §4.7 still expressly uses same-origin-domain for captured
allowlist origins; the historical changelog does not replace that rule.

§12's privacy review confirms that iframe inspection uses the embedding policy
and declared origin, never the loaded child's response policy or actual location.
Potential reports likewise use only embedding state and attribute text. Actual
violations go to the affected Document's reporting scope, not its parent's
observers. Existing query, potential-report, and request-report tests cover these
boundaries with supplied contexts; automatic child navigation remains untested
until its lifecycle exists.

The child can inspect its own inherited restrictions, as §12.3 acknowledges.
Feature owners must preserve their API's specified denial behavior; the framework
does not choose a universal exception or grant user consent. Framing restrictions
remain with CSP/X-Frame-Options and navigation. No runtime change was needed for
these sections.

### Remaining integrations

- **Iframe/navigation:** child creation, navigation, attribute processing, and
  iframe-load steps must supply and retain actual container/response policies.
  `processPolicyAttributes()` supplies container directives from current DOM state.
  Supplied containers/responses now produce and install both policy dispositions.
  Initial creator/environment inheritance is connected; automatic iframe loading
  and child history application remain unfinished. Completing policy algorithms does not complete child navigation.
- **Feature consumers:** `Document.isAllowedToUse()` now checks and reports actual
  use. New feature owners must register definitions, call this boundary, and
  implement their specified failure behavior. Fullscreen must activate and test
  its legacy iframe fallback; Client Hints and other request-feature owners must
  invoke `FetchRequest.isAllowedToUseFeature()`.
  `cross-origin-isolated` and the concrete-isolation Temporal clock are connected
  through the live Document query described above.
- **Permissions:** policy-controlled permission queries already call that
  Document boundary. Changes to effective policy must also notify existing
  `PermissionStatus` results through `UserAgent.notifyPermissionStateChanged()`.
- **Reporting:** actual and potential producers reach shared observer/delivery
  paths. Automatic iframe-load checks and optional script-location capture remain.
- **Workers/worklets:** the draft explicitly leaves their policy model unresolved.
  Its request helper currently rejects non-Window clients. Track that specified
  boundary rather than inventing worker inheritance.

[Focused tests](../../../../test/browlet/browsing/policy/permissions.test.ts)
cover empty-policy initialization, shared feature definitions, and
Document/navigation state isolation, plus allowlist wildcards, captured origins,
domain relaxation, and source expressions. They do not exercise policy enforcement.
[Attribute parser tests](../../../../test/browlet/browsing/policy/permissions-parsing.test.ts)
cover tokenization, duplicate declarations, origin resolution, URL normalization,
and recovery from invalid entries, without requiring iframe navigation.
[Header parser tests](../../../../test/browlet/browsing/policy/permissions-headers.test.ts)
cover both dispositions, whole-field versus member/item failures, source grammar,
token/string distinctions, reporting parameters, and duplicate fields/features.
[Iframe policy tests](../../../../test/browlet/browsing/policy/permissions-iframe.test.ts)
cover projected reflection, declared origins, sandbox/srcdoc precedence, adoption,
namespace filtering, and fresh container maps. They do not load child Documents
or exercise the inactive Fullscreen fallback.
[Inspection tests](../../../../test/browlet/browsing/policy/permissions-inspection.test.ts)
cover identity, brands, returned sequences, detached nodes, adoption, navigation,
policy-record replacement, and live default origins. They do not evaluate policy
enablement or iframe child state.
[Query tests](../../../../test/browlet/browsing/policy/permissions-query.test.ts)
cover origin arguments, inherited/declared/default precedence, parent and target
gates, report-only selection, mutation/adoption, allowed-feature snapshots,
allowlist inspection/defaults/serialization, and Web IDL conversion before policy
reads. They use supplied policy records rather than claiming response installation
or child navigation is complete.
[Reporting tests](../../../../test/browlet/browsing/policy/permissions-reporting.test.ts)
cover projected fields/brands, JSON, filtering, task delivery, replay identity,
and delivery opt-out using explicitly supplied report data. They do not exercise
the actual/potential producers, whose tests are linked in §§9.10–9.14 above.

## Policy state and composition

Policy values travel through environments, Documents, responses, navigation, and
history. Preserve each specification's clone/identity rule rather than copying
ad hoc subsets. PolicyContainer.clone copies populated CSP directives and their
self origin, COEP/referrer state, and both Integrity Policy dispositions.
A container without a known resource origin has no CSP list yet.

The bounded response-bearing Document creation path initializes CSP, sandbox,
COOP, COEP, referrer and integrity policies, upgrade policy, and Reporting endpoints. It is not the complete
navigation state machine. Worker top-level responses and worklet creation must
supply their specified inheritance rather than copying whichever fields are
convenient at realm setup.

Loader response adaptation stays with the loader. Fetch invokes policy through
its narrow contracts; policy languages and browser state remain here.
Blink's policy_container and policy_container_utils illustrate this division
without prescribing Browlet's file structure.

## Fetch-facing policy work

### Trustworthiness

[Secure Contexts](https://w3c.github.io/webappsec-secure-contexts/) origin/URL
trustworthiness is implemented on UserAgent, including secure schemes,
localhost/loopback, opaque/file/Blob origins, and configured trust exceptions.
A potentially trustworthy origin is not by itself a secure environment.

BrowletEnvironmentBase owns the fixed decision before realm creation; BrowletRealm reads
it for exposure and full settings retain it. Window initialization uses an
existing reserved decision or derives one from the selected origin and parent
Window, including insecure intermediate ancestors. New Window creation computes
a new decision. Full iframe/popup, sandbox, worker, and worklet inheritance remain
with those lifecycles.

`SPEC_CLASH(secure-context-top-level-url)` was reviewed at HTML §8.1.3.5.
Its written fallback tests only `topLevelCreationURL` using URL trustworthiness.
That treats creatorless about:blank and top-level data URLs as secure, and does
not account for an insecure intermediate ancestor beneath a secure top-level URL.
Browlet instead preserves its selected-origin and parent-security checks by
agreement. This also preserves classification before binding exposure and the
reserved environment's decision when full settings are created.

Evidence: HTML `webappapis.html#secure-context`; Secure Contexts'
[ancestral-risk discussion](https://w3c.github.io/webappsec-secure-contexts/#ancestors);
and Blink's
[SecurityContext::SetSecurityOrigin](https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/core/execution_context/security_context.cc),
which checks origin trustworthiness and insecure ancestors. Existing
[secure-context tests](../../../../test/browlet/browsing/policy/secure-contexts.test.ts)
cover creatorless/inherited about:blank, data URLs, insecure intermediate
ancestors, configured trust, reserved settings, and Web IDL exposure.
This does not complete sandboxed or worker/worklet setup; their security inputs
must be reviewed with those lifecycles.

### Referrer Policy

[Referrer Policy](https://w3c.github.io/webappsec-referrer-policy/) parsing,
stripping, request calculation, and redirect updates live in
[Fetch](../../../fetch/referrer-policy.ts) and are called directly there.
Window settings use the Document's URL/srcdoc state, not its base URL;
other settings use their creation URL. Stripping returns independent copies.
The same Fetch module owns the shared enum values, TypeScript type, and Web IDL
declaration. Browser-owned source selection and
trust decisions remain environment/UserAgent queries.

Header parsing follows the grammar: ASCII-insensitive tokens, unknown
letter/hyphen extensions, and whole-value rejection for malformed tokens.
Chromium follows that rejection rule; Gecko/WebKit skip malformed tokens.
Absent/rejected headers preserve the request's policy.

`SPEC_CLASH(referrer-empty-policy)`: Referrer Policy
[§3.9](https://w3c.github.io/webappsec-referrer-policy/#referrer-policy-empty-string)
says an empty document policy falls back to strict-origin-when-cross-origin when
determining the request's referrer. Its
[§8.3](https://w3c.github.io/webappsec-referrer-policy/#determine-requests-referrer)
instead says Fetch never passes an empty policy and omits that switch case.
Fetch's main algorithm copies the container value, which HTML response creation
sets to empty when no header is supplied. Browlet follows §3.9 in the calculation,
without rewriting the request or container policy. The same-origin/cross-origin/
downgrade regression first reproduced the thrown unresolved-policy error; existing
Blob/data Fetch tests also exposed it when response policy association was connected.

HTML §2.5.5 now defines referrer-policy attributes over the shared values, and
link/script/iframe expose `referrerPolicy`. An empty or invalid attribute defers to
Fetch's existing policy-container fallback; it does not mean `no-referrer`.
Complete element/stylesheet delivery and inherited state with their loaders.
Supplied-response navigation associates Referrer-Policy with the new Document's
policy container. Meta referrer processing and hyperlink
`rel=noreferrer` are also missing; the complete precedence described by HTML
§2.5.5 requires those consumers, not another shared attribute parser.
Navigable.container is still provisional, so loaded srcdoc remains an approved
expected failure. Use the actual container element's node Document, including
inactive predecessors, rather than the current parent navigable's active Document.

### Integrity Policy

[Subresource Integrity](https://w3c.github.io/webappsec-subresource-integrity/)
policy parsing, independent enforce/report-only association, cloning, blocking,
and violation bodies are implemented. Fetch invokes them and Reporting uploads
their reports. Byte/hash verification remains in [Fetch](../../../fetch/integrity.ts).

Validate the entire Structured Fields dictionary before applying defaults.
Every member must be an inner list of tokens, including unknown keys. Invalid
present fields replace only their policy with an empty policy; absent fields
preserve it. Missing sources defaults to inline, while an explicit empty or
unsupported-token list stays empty.

Retain both dispositions when cloning despite HTML omitting report-only state.
Malformed-field handling is a draft gap: Browlet rejects the whole header;
browser recovery differs. Report once per endpoint as the draft/Gecko/WebKit do;
an enforced policy still blocks with no endpoints. Preserve boolean reportOnly
and the concrete observer body. [Issue notes](../../../../scratch/SPEC-ISSUES.md#integrity-policy-malformed-structured-fields-and-stale-parser-call)
retain the reviewed parser/model differences. Supplied-response navigation now
delivers both headers. Element/preload inputs and full policy lifecycle remain owner work.

### HSTS

[RFC 6797](https://www.rfc-editor.org/rfc/rfc6797.html) was audited in full on
2026-09-22, including appendices, errata, and §12's non-normative advice.
The implemented browser algorithms are principally §§6.1 and 8; server emission
and Effective Request URI reconstruction are server responsibilities.

`UserAgent.hstsStore` owns remembered hosts across Documents. `HSTSPolicy.parse()`
expects an unfolded field value. Processing uses the first STS field only,
requires authenticated HTTPS without certificate errors, excludes IP addresses,
and supports refresh, exact-host removal, and expiry. Bigint lifetime arithmetic
avoids overflow. Missing headers preserve state; repeated identical max-age
values refresh expiry from receipt time, not the server's Date.

`requiresHTTPS()` checks exact hosts and DNS-label ancestors with
includeSubDomains. A child's removal or expiry cannot override a live parent.
Fetch's `upgradeForHSTS()` upgrades the current URL on main-fetch entry and
redirect re-entry, preserves non-default ports, and applies Fetch's
localhost/public-suffix exception. Network response processing learns policy
from actual TLS evidence before redirects, including non-2xx responses.

Accepted choices and evidence:

- Follow §6.1 by rejecting every duplicate directive, including unknown names.
  Gecko's `ParseSSSHeaders` and Chromium's
  [`ParseHSTSHeader`](https://github.com/chromium/chromium/blob/main/net/http/http_security_headers.cc)
  reject only repeated known directives. WebKit's libsoup ports use the
  [strict parameter parser](https://github.com/GNOME/libsoup/blob/master/libsoup/soup-headers.c),
  rejecting all duplicate names. Well-formed unknown directives are ignored;
  malformed ones invalidate the policy. Quoted values are unescaped first.
- Remove expired entries along the queried host path, as
  [Chromium](https://chromium.googlesource.com/chromium/src/+/main/net/http/transport_security_state.cc)
  and [Gecko](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/security/manager/ssl/nsSiteSecurityService.cpp#L904)
  do. Accepting a valid authenticated policy also sweeps unrelated expired
  entries at most once per minute. Ineligible responses do not trigger a sweep;
  lookups always ignore expired policy. No background timer or expiry heap.
  Gecko separately caps storage; [libsoup](https://github.com/GNOME/libsoup/blob/master/libsoup/hsts/soup-hsts-enforcer.c)
  sweeps on policy replacement/removal. Safari's CFNetwork eviction is not
  exposed by public WebKit source; libsoup evidence is not Safari evidence.
- Reuse URL's canonical host, omitting the DNS root dot for storage. URL's
  non-strict IDNA behavior can preserve ASCII labels rejected by strict IDNA
  (the URL test includes `xn--8i7caa`); do not introduce a conflicting HSTS-only
  host normalizer. RFC §13 permits UTS #46. Rejected errata
  [5372](https://www.rfc-editor.org/errata/eid5372) and
  [8153](https://www.rfc-editor.org/errata/eid8153) do not change refresh or create
  an RFC localhost exception; that exception comes from Fetch.

Remaining integration and host choices:

- HTML meta processing must ignore `Strict-Transport-Security` for both learning
  and removal (§8.5); retain a negative regression with the future consumer.
- HTTPS DNS-record upgrades are separate unfinished Fetch/transport work.
- Keep ordered, separate STS fields through transport and TLS verification
  distinct from bypassing certificate errors. HSTS requires termination on every
  TLS error or warning, without HTTP fallback or user bypass, including direct
  HTTPS loads (§8.4). Existing Fetch/transport tests
  cover field preservation, policy learning, verified TLS, and untrusted-certificate
  rejection; remaining Fetch transport work stays in its roadmap.
- Preloads, configured hosts, lifetime/capacity limits, disk persistence, and
  deliberate per-host deletion are optional host features. Profile/private-mode
  and browsing-data clearing work must address HSTS retention: state can encode
  browsing history (§14.9).

HTTP Public Key Pinning (RFC 7469) is not a prerequisite or planned feature.
Its mention in SRI's introduction is informative: dynamic HPKP was
[removed in Chrome 72](https://developer.chrome.com/blog/chrome-72-deps-rems#remove-http-based-public-key-pinning)
and [disabled in Firefox 72](https://bugzilla.mozilla.org/show_bug.cgi?id=1412438#c23).
Application-configured certificate pins would be a separate transport feature.

### Mixed Content and Upgrade Insecure Requests

[Mixed Content](https://w3c.github.io/webappsec-mixed-content/) and
[Upgrade Insecure Requests](https://w3c.github.io/webappsec-upgrade-insecure-requests/)
were audited in full. Independent algorithms and Fetch ordering are implemented:
monitored CSP reporting, UIR upgrade, eligible mixed-content upgrade, then
enforced request blocking; response checks follow URL-list population.
Failed HTTPS upgrades cannot fall back to plaintext. HSTS has its own stage.

The environment's mixed-security classification checks its origin and Window
ancestors separately from secure-context exposure. Mixed-download checks examine
all response URL hops against the initiating Document; a secure final hop cannot
erase an insecure redirect.

Approved choices use the current request URL, include eligible CORS images in
automatic mixed-content upgrading, compare navigation targets by host and port,
and exempt trustworthy HTTP UIR targets such as localhost. A single preference
header is set on every navigation. [Decision evidence](../../../../scratch/SPEC-ISSUES.md#mixed-content--upgrade-insecure-requests-reviewed-interpretations)
retains the specification/browser differences.

InsecureRequestsPolicy belongs to environments and browsing contexts.
Nested-context inheritance uses the embedding element's current node Document,
not its creation realm after adoption. Document initialization copies context
policy before CSP; Window reuse clears the former Document's directive state.
Focused tests cover inheritance independently of unfinished full DOM adoption
and nested-context construction.

Remaining consumers:

- Navigation/forms must supply form-submission state for GET as well as POST,
  and distinguish top-level document requests from nested destinations.
- Navigation and hyperlink downloads must call the mixed-download check before
  acceptance. Those HTML consumers remain unfinished.
- Worker creation must inherit upgrade state/targets and retain the initiating
  worker as the report recipient. Inherited policy must never route violations
  or SecurityPolicyViolationEvent to the ancestor that enabled it.
- Optional insecure-form warnings must cover redirects and permit cancellation;
  any optional override controls must also be accessible (Mixed Content §7).
  Browlet currently exposes no bypass. The obsolete block-all-mixed-content
  directive needs no second flag.

## Validation and sources

Tests cover parsing, independent policy copies, URL/origin decisions, real Fetch
checks/ordering, shared reports, active Document initialization, and composed
inheritance. Full iframe/navigation/worker behavior must be tested when its
owners exist; policy-unit coverage does not establish it.

Local source checkouts include
`w3c-secure-contexts/index.bs`, `w3c-referrer-policy/index.src.html`,
`w3c-subresource-integrity/index.bs`, `w3c-mixed-content/index.bs`, and
`w3c-upgrade-insecure-requests/index.bs`. Retained browser comparisons are
September 2026 evidence, not newly rerun observations.
