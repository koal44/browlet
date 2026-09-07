# Structured fields roadmap

This project will own the realm-neutral value model, parsing, and serialization
for [RFC 9651, Structured Field Values for HTTP](https://www.rfc-editor.org/rfc/rfc9651.html).
It supplies shared algorithms to Fetch, browser policy, and Reporting without
depending on their request, response, or environment objects.

**Status:** planned; no implementation or library has been selected.

## Sources

Paths relative to the [local reference root](../fetch/preflight.md#local-reference-inventory):

- `rfcs/rfc9651.txt`: §3 data types and §4 serialization/parsing. This published
  RFC supersedes RFC 8941 and is the version referenced by Fetch.
- `httpwg-structured-field-tests/README.md` and its JSON fixtures: test format,
  parsing vectors, and `serialisation-tests/` cases. These are evidence to run
  against the RFC, not an alternative specification.
- `whatwg-fetch/fetch.bs`, §2.2.2: the consuming get/set structured-field
  operations. Header lists and their integration remain in Fetch.

## Implementation order

1. **Value model (§3).** Represent lists, dictionaries, items, inner lists,
   ordered parameters, and the eight bare item types. Preserve distinctions
   such as tokens versus strings and dates versus integers. Suggested files
   are `values.ts`, `serialize.ts`, and `parse.ts`.
2. **Serialization (§4.1).** Implement the type-specific algorithms, permitted
   ranges/precision, escaping, delimiters, and failure behavior. Resolve how
   our representation enforces numeric limits before choosing its numeric
   types; serialization must not silently repair an invalid value.
3. **Parsing (§4.2).** Implement each parser, parameter handling, whitespace,
   duplicate-key rules, and complete-input validation. Generic field parsing
   must retain the requested top-level type and the specified failure result.
4. **Consumer integration.** Fetch's header-list operations consume these
   algorithms directly. Header-specific allowed keys and meanings stay with
   the specification defining that header.

Reuse Infra bytes/strings and existing encoding primitives where their
contracts match. If considering a library, verify RFC 9651 coverage, especially
dates/display strings and serialization failures, before adopting it.

## Exit proof

Run the HTTPWG parse and serialization vectors, retaining their distinction
between mandatory failures and cases where failure is permitted. Their JSON
binary representation uses Base32; that is a test-fixture encoding, not the
wire encoding for structured-field byte sequences.

Add focused tests for the public internal value representation, numeric
boundaries, ordering, invalid trailing input, and values that cannot serialize.
Parsing and serialization must each have independent expectations; a round
trip can conceal a shared mistake. Fetch integration tests then exercise
multiple header lines, missing values, and get/set failures through its own
header-list operations.

Remove this roadmap when the shared algorithms and first consumers have those
tests and any remaining gaps have a narrower owner.
