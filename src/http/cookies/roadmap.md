# Cookies roadmap

This submodule will own cookie records, the cookie store, and parsing, storage,
retrieval, and serialization algorithms. Fetch and HTML consume the same
implementation. Browlet owns store instances and supplies browser policy;
this project must not discover a process-global cookie jar or import Browlet.

**Status:** planned; no implementation or library has been selected.

## Sources

Use [Cookies: HTTP State Management Mechanism](https://httpwg.org/http-extensions/draft-ietf-httpbis-layered-cookies.html),
the layered-cookies draft currently referenced by Fetch. Record its revision
when implementing; it is a draft, not a published replacement RFC yet.

Local sources under the [reference root](../../fetch/preflight.md#local-reference-inventory):

- `httpwg-http-extensions/draft-ietf-httpbis-layered-cookies.md`: §5
  user-agent records, eviction, subcomponent/main algorithms, and browser
  requirements; consult server syntax to interpret the wire format.
- `whatwg-fetch/fetch.bs`, §3.1: HTTP cookie integration and browser inputs.
- `whatwg-html/source`: cookie access through Document, same-site context,
  and other browser-owned decisions. The draft's non-browser user-agent
  defaults must not replace these rules.

## Implementation order

1. **Records and store.** Model the complete cookie record, identity,
   replacement, expiry, and limits. Reuse URL host/public-suffix operations;
   supply time and host policy explicitly where the algorithms require them.
2. **Subcomponent algorithms.** Implement cookie dates, domain matching,
   default paths, and path matching. Cookie-date parsing has its own rules;
   a platform date parser is not sufficient evidence of equivalence.
3. **Parse/store/retrieve/serialize.** Follow the draft's main algorithms,
   including Secure, HttpOnly, SameSite, name prefixes, partition inputs,
   ordering, deletion, and eviction. A `Set-Cookie` value is processed
   separately; it must not be treated as a comma-combinable field.
4. **Browser integration.** Fetch supplies request/response and credentials
   decisions through its [HTTP integration](../../fetch/http/roadmap.md).
   Browlet's Document implementation supplies non-HTTP access and the
   required browser context. The core does not infer those contexts from
   whichever realm happens to be executing.

Evaluate any candidate library against these algorithms and the selected
draft revision. General RFC 6265 compatibility is not enough to establish
coverage of the current browser contract.

## Exit proof and later scope

Use table-driven tests for parsing, rejected cookies, replacement/deletion,
domain/path boundaries, expiry, retrieval ordering, prefixes, secure/HTTP-only
access, SameSite, and partitions. Then test real Fetch/Document consumers
against a shared Browlet-owned store, including credentials omission and
redirect handling.

Network cookie handling does not require implementing the separate Cookie
Store API. Persistent storage and user controls can follow an in-memory store
with explicit policy inputs; their absence must not silently change the
specified acceptance/retrieval rules.

Remove this roadmap when the core and reached browser consumers are covered,
with any remaining public API or persistence work assigned to its owner.
