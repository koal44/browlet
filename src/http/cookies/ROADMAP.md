# Cookies roadmap

This submodule will own cookie records, the cookie store, and parsing, storage,
retrieval, and serialization algorithms. Fetch and HTML consume the same
implementation. Browlet owns store instances and supplies browser policy;
this project must not discover a process-global cookie jar or import Browlet.

**Status:** planned; no implementation or library has been selected.
Cookies are next in the agreed Fetch dependency detour, after Window secure
contexts. Resume Fetch Slice 6 after the chosen prerequisite work.

## Sources

Use [Cookies: HTTP State Management Mechanism](https://httpwg.org/http-extensions/draft-ietf-httpbis-layered-cookies.html),
the layered-cookies draft currently referenced by Fetch. Record its revision
when implementing; it is a draft, not a published replacement RFC yet.

Preparation reviewed 2026-09-20 against the live draft and local checkout
`1057fe0f1570aa539eb90502411995e28ba304c7`. Recheck the source revision when
implementation starts.

Local sources under the [reference root](../../fetch/PREFLIGHT.md#local-reference-inventory):

- `httpwg-http-extensions/draft-ietf-httpbis-layered-cookies.md`: §5
  user-agent records, eviction, subcomponent/main algorithms, and browser
  requirements; consult server syntax to interpret the wire format.
- `whatwg-fetch/fetch.bs`, §3.1: HTTP cookie integration and browser inputs.
- `whatwg-html/source`: cookie access through Document, same-site context,
  and other browser-owned decisions. The draft's non-browser user-agent
  defaults must not replace these rules.

## Implementation order

1. **Records, limits, and eviction (§§5.1–5.2).** Start here, in document order.
   Model the cookie record and store, expiry, per-host/global limits, and
   removal order. Supply time explicitly; reuse URL host equality. Replacement
   belongs to the later store algorithm, rather than a second insertion path.
2. **Subcomponent algorithms (§5.3).** Implement cookie dates, domain matching,
   default paths, and path matching. Cookie-date parsing has its own rules;
   a platform date parser is not sufficient evidence of equivalence.
3. **Parse/store/retrieve/serialize (§5.4).** Follow the draft's main algorithms,
   including Secure, HttpOnly, SameSite, and all four name prefixes,
   ordering, deletion, and eviction. A `Set-Cookie` value is processed
   separately; it must not be treated as a comma-combinable field.
4. **Browser integration.** Fetch supplies request/response and credentials
   decisions through its [HTTP integration](../../fetch/http/ROADMAP.md).
   Browlet's Document implementation supplies non-HTTP access and the
   required browser context. The core does not infer those contexts from
   whichever realm happens to be executing.

## Dependencies and stopping points

- URL already supplies parsed hosts, host equality, public-suffix lookup, URL
  paths, and site comparisons. Cookie domain/path matching and cookie dates
  still need their own specified algorithms.
- Add a cookie TypeScript project when source is introduced: HTTP's current
  syntax/cache project has no URL dependency and does not include this folder.
- Keep cookie `isSecure` separate from `Environment.isSecureContext`. The
  current Fetch §3.1 callers derive it from the request URL's HTTPS scheme.
- Full browser integration requires HTML's cross-site-ancestor answer, which
  `WindowEnvironmentSettingsObject.hasCrossSiteAncestor` currently leaves
  unimplemented. Fetch's same-site-mode algorithm and request/response cookie
  hooks are also unfinished. Keep those dependencies explicit when reached;
  they do not block the cookie core.
- The reviewed layered draft does not define a partition-key field or the
  `Partitioned` attribute algorithms; its source contains only a commented-out
  partition field. Review CHIPS and browser storage-partition policy separately
  before adding partition state or treating that coverage as complete.

Evaluate any candidate library against these algorithms and the selected
draft revision. General RFC 6265 compatibility is not enough to establish
coverage of the current browser contract.

## Exit proof and later scope

Use table-driven tests for parsing, rejected cookies, replacement/deletion,
domain/path boundaries, expiry, retrieval ordering, prefixes, secure/HTTP-only
access, and SameSite. Then test real Fetch/Document consumers
against a shared Browlet-owned store, including credentials omission and
redirect handling.

Network cookie handling does not require implementing the separate Cookie
Store API. Persistent storage and user controls can follow an in-memory store
with explicit policy inputs; their absence must not silently change the
specified acceptance/retrieval rules.

Remove this roadmap when the core and reached browser consumers are covered,
with any remaining public API or persistence work assigned to its owner.
