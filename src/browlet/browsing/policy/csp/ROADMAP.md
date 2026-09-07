# Content Security Policy roadmap

This folder will own Browlet's
[Content Security Policy Level 3](https://w3c.github.io/webappsec-csp/)
implementation. The [parent policy roadmap](../ROADMAP.md) owns policy-container
association and the neighboring policies; CSP owns its language, directive
behavior, violations, and integration algorithms.

**Status:** planned. CSP is the last stage of the
[Fetch preflight order](../../../../fetch/PREFLIGHT.md#rejoin-fetch-then-finish-browser-policy).
The existing `cspList` slot does not implement policy parsing or enforcement.

## Sources and first scope

Local source: `w3c-csp/index.bs` under the
[reference root](../../../../fetch/PREFLIGHT.md#local-reference-inventory).
Read the framework, delivery, integrations, reporting, directive definitions,
and algorithms. The first supported consumer is Fetch; use its real
request/response records rather than a CSP-specific substitute.

1. **Policy model and parsing.** Implement serialized policies, policy lists,
   dispositions, directive/source-list records, and header parsing. Preserve
   multiple policies and the specified unknown/duplicate-directive behavior.
2. **Fetch checks.** Implement request/response blocking and the directive
   matching/fallback algorithms they call, including redirects, source
   matching, and policy disposition. A passing empty-policy path is only the
   unconfigured case.
3. **Delivery and violations.** Connect response policy delivery and container
   association to the loader; implement violation construction, reporting,
   and SecurityPolicyViolationEvent through existing DOM/Web IDL machinery.
   Shared report transport belongs to [Reporting](../../../reporting/ROADMAP.md).
4. **Other consumers.** Add document/meta initialization, inline script/style
   and navigation checks, then string/Wasm compilation hooks when those
   consumers are implemented. Audit Trusted Types and other named external
   dependencies at their actual call sites before claiming those branches.

Upgrade Insecure Requests and Mixed Content have their own algorithms under
the parent policy owner. CSP supplies the relevant policy/directive inputs;
it must not acquire another request-upgrade implementation.

## Exit proof and limits

Focused tests cover parsing, source matching, directive fallback, multiple
policies, redirect behavior, and enforce/report-only differences. Integration
tests demonstrate that real Fetch requests/responses are blocked or allowed,
and that violations reach the shared reporting/event lifecycle.

Later loader/compiler tests must exercise inline code, nonces/hashes, meta
delivery, and code-generation behavior when supported. Do not expose those
branches as working merely because their policy text parses. Broad CSP
conformance remains incomplete until those consumer-specific gates close.

Remove this roadmap when the reached CSP integrations are implemented and
remaining consumer work has a narrower plan.
