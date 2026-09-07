# Browsing policy roadmap

The current files hold real slots and default values needed by Document and
navigation. Their policy languages and enforcement algorithms are not yet
implemented.

| File | Missing contract | Specification |
| --- | --- | --- |
| `scripting/agents.ts` plus loader response processing | `Origin-Agent-Cluster` parsing, historical key selection, and agent-cluster-key consequences | HTML §7.1.2 |
| `coop.ts` | Response parsing, enforcement result, browsing-context group switching, reporting | HTML §7.1.3 |
| `coep.ts` | Embedder-policy value/reporting endpoint, response processing, reporting | HTML §7.1.4 |
| `sandbox.ts` | Parsing sandbox tokens, determining flags, propagation and navigation checks | HTML §7.1.5 |
| iframe element plus Document ancestry | iframe referrer-policy inheritance and ancestor-origin list construction | HTML §7.1.6 |
| `permissions.ts` | HTML's policy-controlled feature definitions/default allowlists plus declared, inherited, and container policy checks | HTML §2.2; Permissions Policy; HTML Document, browsing-context, and lifecycle integration |
| `container.ts` | Clone/determine policy container, CSP/referrer/integrity/COEP association | HTML §7.1.7 |

Policy data travels with environments, Documents, history entries, responses,
and navigations. Keep one typed value model here and apply each specification's
explicit clone or identity rule; do not duplicate policy state in each
subsystem.

Worker globals receive policy-container and embedder-policy state while their
top-level script response is processed; worklet settings clone the creator's
policy container. Worker/worklet modules should retain those specified
identity rules instead of copying an ad hoc policy subset during realm setup
(HTML §§10.2.1, 10.2.4, and 11.3.1.3).

Response-bearing navigation installs response policies; Fetch applies their
request/response checks for its clients. Nested
browsing adds sandbox flags, referrer and container policy, COEP, and
Window/Location access checks; top-level cross-origin navigation separately
adds COOP browsing-context-group switching. The loader passes response headers
to the owning policy parser; policy meaning and inherited state remain here.

Blink's `core/frame/policy_container.*` and
`platform/loader/fetch/policy_container_utils.*` demonstrate the useful split
between the container's state and response/fetch conversion. Browser-side
loader adaptation remains in `loader/`; the independent Fetch implementation
lives in `src/fetch`.

## Fetch-facing policy work

This section owns the policies implemented directly in this folder. The
[CSP roadmap](csp/roadmap.md) owns CSP details, and
[Reporting](../../reporting/roadmap.md) owns shared report delivery. Fetch owns
request/response processing and invokes these browser policies through
explicit integration. Implementation order is in the
[Fetch preflight](../../../fetch/preflight.md#work-order).

Source paths below are relative to that preflight's local reference root.
These algorithms are planned; existing slots are not working enforcement.

### Trustworthiness

Read [Secure Contexts](https://w3c.github.io/webappsec-secure-contexts/), local
`w3c-secure-contexts/index.bs`. Implement URL/origin trustworthiness first,
then environment classification over real settings, ancestry, and creator
state. Reuse URL records; a context cannot always be classified from its own
URL or its existing supplied boolean alone.

Test HTTPS, loopback/localhost, opaque origins, relevant non-network schemes,
and configured trust exceptions. Add ancestry/worker cases with those
lifecycles. Referrer Policy and Fetch Metadata consume the same classifier.

### Referrer Policy

Read [Referrer Policy](https://w3c.github.io/webappsec-referrer-policy/), local
`w3c-referrer-policy/index.src.html`, including all policy values and §8.
Implement header parsing, referrer calculation/stripping, and redirect updates.
HTML supplies delivery/inheritance and Fetch supplies request/client records.
Reuse trustworthiness for downgrade decisions.

Test every policy across same-/cross-origin and trustworthiness changes,
credential/fragment removal, and redirects. Then test actual loader/element
delivery; the stored default policy is only the starting value.

### Integrity Policy

Read the Integrity-Policy section of
[Subresource Integrity](https://w3c.github.io/webappsec-subresource-integrity/),
local `w3c-subresource-integrity/index.bs`. Implement structured-field policy
parsing, container association, and request enforce/report-only decisions.
It depends on [structured fields](../../../struct-fields/roadmap.md),
Fetch records, and Reporting. Byte/hash verification is owned by
[Fetch's integrity work](../../../fetch/roadmap.md#subresource-integrity).

Test supported destinations/sources, malformed policy fields, request
blocking, report-only behavior, and endpoint/report association through real
policy-container delivery.

### HSTS

Read [RFC 6797](https://www.rfc-editor.org/rfc/rfc6797.html) §§6.1 and 8,
local `rfcs/rfc6797.txt`. Implement header processing, host storage, expiry,
`max-age=0` removal, includeSubDomains matching, and URI/port upgrade rules.
The User Agent owns this host state; it is not a per-Document policy-container
slot. Fetch consumes host matching and upgrades; transport supplies verified
secure-connection results and enforces the required failure behavior.

Test learning over secure versus insecure transport, expiry, domain matching,
and port mapping with controlled clocks. Later network tests must prove an
HSTS certificate failure cannot fall back to HTTP. Preload distribution and
disk persistence remain explicit host choices.

### Mixed Content and Upgrade Insecure Requests

Read [Mixed Content](https://w3c.github.io/webappsec-mixed-content/) and
[Upgrade Insecure Requests](https://w3c.github.io/webappsec-upgrade-insecure-requests/),
local `w3c-mixed-content/index.bs` and
`w3c-upgrade-insecure-requests/index.bs`. Suggested files are
`mixed-content.ts` and `upgrade-insecure-requests.ts`.

Implement their request upgrade/blocking and response checks with explicit
client/policy inputs and shared trustworthiness rules. CSP supplies its
directive inputs when integrated. Test destination-sensitive decisions,
upgrades, response failures, and report/enforcement effects through Fetch.
These policies do not replace HSTS or TLS verification.

## Removal condition

Burn this file after all listed value models and their navigation/loader
integrations have behavior tests.
