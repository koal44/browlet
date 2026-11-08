# Permissions Policy roadmap

[Permissions Policy](https://w3c.github.io/webappsec-permissions-policy/) is owned
by [policy.ts](policy.ts), [permissions-policy.ts](permissions-policy.ts), and
[reporting.ts](reporting.ts).
It controls feature availability in Documents; the separate
[Permissions Standard](../../../../permissions/ROADMAP.md) owns user consent.

Reviewed against the 26 October 2026 draft, source revision
[`81e7009`](https://github.com/w3c/webappsec-permissions-policy/tree/81e7009cd714acc2efff79bc028ef990cdb9bf44).
The local `w3c-permissions-policy` checkout was fast-forwarded to this revision.
The document-order pass is complete through §13. The framework algorithms,
inspection bindings, and reporting producers exist; the remaining integrations
below still limit browser-level coverage. Recorded specification/browser clashes
remain deliberate choices to revisit when the sources converge.

## Permissions Policy clock prerequisite

Temporal's concrete-isolation precision depends on
`Document.isAllowedToUse('cross-origin-isolated')`. Its activity gates and policy
check now work: inherited/header/container restrictions decide availability, with
actual violation reports from §9.10. The supplied-response path installs both
policies. Automatic child creation and the full navigation loader remain unfinished.
This policy is separate from the Permissions API used by Storage.

The [HTML clock integration](../../../scripting/ROADMAP.md#8165-temporal-clock-calculation-and-installation-boundary)
installs its callback in every isolation mode. Registration retains the callback
without querying the not-yet-attached Document; navigation installs the Document
and policies before author code runs. Clock reads use the live activity and policy
checks, including violation reports. Retained inactive Documents receive coarser
precision. Native AgentCluster isolation and the existing clock backend/range
limits remain separate from this policy connection.

## §§1–3: introduction, examples, and related mechanisms

These sections introduce header restrictions, delegation to selected frames,
and the relationship to sandboxing. They add no independent runtime algorithms.
The examples are future integration cases, not current conformance claims.
Allowing a feature through policy does not grant user permission, and this policy
does not replace iframe or CSP sandbox restrictions.

## §§4.1–4.2: features and policy state

The policy module indexes Browlet's supported feature definitions by their unique
tokens. This fixed catalog is shared across browser instances. The initial entry
is HTML's `cross-origin-isolated`, whose default allowlist is `self`. Fetch's
`deferred-fetch` (`self`) and `deferred-fetch-minimal` (`*`) now support navigation
quota reservation and Document accounting. Their registration also makes them
visible in policy inspection and potential-violation reporting; it does not
expose the unfinished `fetchLater()` API. See the
[quota audit](../../navigation/ROADMAP.md#deferred-fetch-quota-at-navigation).
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

## §§4.3–4.8: policy relationships and allowlists

§§4.3–4.6 define the relationships between inherited state, response declarations,
and container directives. The existing records hold inherited values and declared
allowlists. §§9.5–9.7 combine container inheritance with response declarations.

`PermissionsPolicyAllowlist.matches(origin)` implements §4.7. The class represents
the policy wildcard with `matchesAllOrigins`; otherwise it uses its expressions
and captured origins. Captured `self` and `src` origins use HTML's same
origin-domain comparison, including opaque identity. Other opaque origins fail;
scheme/host expressions use the existing CSP matcher against the serialized
origin with redirect count zero. CSP's documented source-matching choices remain
in [its roadmap](../csp/ROADMAP.md). Parsing must resolve keywords and admit only
scheme/host expressions before calling this matcher.

§4.8's `*` and `self` defaults are represented in feature definitions and applied
by §§9.7–9.9. Explicit allowlist matching alone does not enable a feature or
enforce a Document policy.

## §5.1: attribute syntax and §9.3 parsing

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

## §§5.2 / 6.1: header syntax and §§9.1–9.2 parsing

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

## §§6.2–6.3: iframe attributes and §9.4 processing

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

## §§7.1–7.2: inspection objects and supported features

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

## §7.2 allowsFeature() and §§9.7–9.9 query dependencies

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

## §7.2 allowedFeatures()

`allowedFeatures()` captures the default origin and observable policy once,
then returns supported feature names whose policy check succeeds at that origin.
Unlike `features()`, this list reflects current enforced restrictions; it ignores
report-only declarations. Binding projects a fresh Array on each call, so earlier
results remain snapshots after attribute changes, adoption, or policy replacement.
This operation adds no dependencies beyond the existing query checks.

## §7.2 getAllowlistForFeature()

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

## §8: report bodies and shared Reporting

[`PermissionsPolicyViolationReportBodyImpl`](reporting.ts) snapshots
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

## §9.5: create a policy for a navigable

`PermissionsPolicy.create(container, origin)` captures each supported feature's
inherited value through §9.7. Top-level destinations start enabled; embedded
destinations combine the parent's enforced restrictions, current container
attributes, and supplied destination origin. The new policy's declarations and
reporting configuration remain empty. Later parent or attribute changes do not
rewrite an already-created policy.

Iframe inspection reuses this factory with the current declared origin on every
query. Creation can instead use a different destination origin, such as after a
redirect. [Creation tests](../../../../../test/browlet/browsing/policy/permissions-creation.test.ts)
cover delegation, parent restrictions, destination-origin changes, independent
policy state, and denial through nested supplied Documents. They do not simulate
iframe loading. Initial iframe context creation now applies those inherited
policies; automatic element loading and child history application remain unfinished.

## §9.6: response policy creation and §10.1 Document initialization

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

## §§9.10–9.11 and 9.13: feature use and actual violation reports

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

[Feature-use tests](../../../../../test/browlet/browsing/policy/permissions-enforcement.test.ts)
cover response-installed policies, all enforced/report-only outcomes, silent
queries, inherited denial, default-origin checks, report destinations, observer
delivery without an endpoint or outbound permission, and activity gates. Existing
Window settings tests now exercise the implemented concrete-isolation policy query.

## §§9.12 and 9.14: potential iframe violations

`HTMLIFrameElementImpl.checkPotentialPermissionsPolicyViolation(allowAttribute,
srcAttribute)` checks each supported feature at the iframe's current declared
origin. Enforced inherited denial wins; otherwise report-only inherited denial
produces a `report` disposition. Endpoint selection follows the corresponding
policy on the iframe's current node Document. Reporting uses that Document's
environment, including after adoption; it does not read the loaded child's policy.

The environment forwards to the potential-report producer in
`reporting.ts`. The report retains both supplied attribute values
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

**Integration boundary:** [§10.1](#101-html-integration) now connects the checker
after iframe load handlers through HTML's completion operation. Attribute changes
and arbitrary author-dispatched events do not invoke it. Automatic iframe
insertion/loading and pending fallback resource timing remain separate dependencies.

[Potential-report tests](../../../../../test/browlet/browsing/policy/permissions-potential.test.ts)
cover both dispositions, defaults, parent restrictions, endpoint selection,
src/srcdoc/sandbox inputs, raw attribute snapshots, observer delivery, adoption,
and independence from supplied child policy. They do not establish iframe loading.

## §9.15: request feature checks

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

[Request tests](../../../../../test/browlet/browsing/policy/permissions-request.test.ts)
cover client/owner separation, resolved and opaque origins, redirects, inherited
denial, both report dispositions/endpoints, and retained clients after navigation.

## §10.1: HTML integration

The [draft's HTML amendments](https://w3c.github.io/webappsec-permissions-policy/#changes-to-html)
have two integration points:

| Amendment | Current implementation |
| --- | --- |
| Initialize each Document's report-only policy, then install the response-derived policy during creation | `DocumentImpl` owns an independent empty policy. `Navigable.createAndInitializeDocument()` derives the response policy from the actual container and origin and installs it before exposing the new Document. Covered by the policy initialization and response-creation tests. |
| Check potential violations after the iframe element's `load` event | `HTMLIFrameElementImpl.runLoadEventSteps()` checks the mute flag, sets load-in-progress, dispatches, checks current potential violations, then clears load-in-progress. `DocumentImpl.completelyFinishLoading()` queues it separately from the child Window's event. Pending fallback timing remains a throwing dependency. |

The [iframe load event steps](https://html.spec.whatwg.org/multipage/iframe-embed-object.html#iframe-load-event-steps)
read raw `allow` and `src` after dispatch, so synchronous load handlers' mutations
are reflected. The checker uses the element's then-current node Document after
adoption. A muted load skips dispatch and reporting; a pending fallback timing
measurement still stops at its explicit dependency before either operation.

HTML's [complete-loading algorithm](https://html.spec.whatwg.org/multipage/document-lifecycle.html#completely-finish-loading)
queues those steps for an iframe container on the parent Document's DOM
manipulation task source. Initial `about:blank` insertion has a separate
synchronous caller in iframe attribute processing. Automatic child insertion,
attribute processing, `document.open()`'s mute producer, and fallback resource
timing remain HTML loading dependencies; no load-event listener or direct
checker call substitutes for those algorithms.

The existing [response-creation tests](../../../../../test/browlet/browsing/policy/permissions-creation.test.ts)
cover supplied child containers, both response dispositions, replacement on
navigation, and report-only isolation from enforcement. The
[potential-report tests](../../../../../test/browlet/browsing/policy/permissions-potential.test.ts)
cover reporting and adoption directly. The
[completion tests](../../../../../test/browlet/browsing/navigation/document-load-completion.test.ts)
exercise the queued iframe operation, flags, current attributes after handlers,
and automatic task delivery with an explicitly supplied child association.

## §§11–13: registration, privacy/security, and change history

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

## Remaining integrations

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

[Focused tests](../../../../../test/browlet/browsing/policy/permissions.test.ts)
cover empty-policy initialization, shared feature definitions, and
Document/navigation state isolation, plus allowlist wildcards, captured origins,
domain relaxation, and source expressions. They do not exercise policy enforcement.
[Attribute parser tests](../../../../../test/browlet/browsing/policy/permissions-parsing.test.ts)
cover tokenization, duplicate declarations, origin resolution, URL normalization,
and recovery from invalid entries, without requiring iframe navigation.
[Header parser tests](../../../../../test/browlet/browsing/policy/permissions-headers.test.ts)
cover both dispositions, whole-field versus member/item failures, source grammar,
token/string distinctions, reporting parameters, and duplicate fields/features.
[Iframe policy tests](../../../../../test/browlet/browsing/policy/permissions-iframe.test.ts)
cover projected reflection, declared origins, sandbox/srcdoc precedence, adoption,
namespace filtering, and fresh container maps. They do not load child Documents
or exercise the inactive Fullscreen fallback.
[Inspection tests](../../../../../test/browlet/browsing/policy/permissions-inspection.test.ts)
cover identity, brands, returned sequences, detached nodes, adoption, navigation,
policy-record replacement, and live default origins. They do not evaluate policy
enablement or iframe child state.
[Query tests](../../../../../test/browlet/browsing/policy/permissions-query.test.ts)
cover origin arguments, inherited/declared/default precedence, parent and target
gates, report-only selection, mutation/adoption, allowed-feature snapshots,
allowlist inspection/defaults/serialization, and Web IDL conversion before policy
reads. They use supplied policy records rather than claiming response installation
or child navigation is complete.
[Reporting tests](../../../../../test/browlet/browsing/policy/permissions-reporting.test.ts)
cover projected fields/brands, JSON, filtering, task delivery, replay identity,
and delivery opt-out using explicitly supplied report data. They do not exercise
the actual/potential producers, whose tests are linked in §§9.10–9.14 above.
