# Structured fields roadmap

This project owns the realm-neutral value model, parsing, and serialization
for [RFC 9651, Structured Field Values for HTTP](https://www.rfc-editor.org/rfc/rfc9651.html).
It supplies shared algorithms to Fetch, browser policy, and Reporting without
depending on their request, response, or environment objects.

**Status:** slices 1 and 2 (values, serialization, and parsing) implemented.
Fetch integration is deferred until its header-list infrastructure is ready.

## Sources

Paths relative to the [local reference root](../fetch/preflight.md#local-reference-inventory):

- `rfcs/rfc9651.txt`: §3 data types and §4 serialization/parsing. This published
  RFC supersedes RFC 8941 and is the version referenced by Fetch.
- `httpwg-structured-field-tests/README.md` and its JSON fixtures: test format,
  parsing vectors, and `serialisation-tests/` cases. These are evidence to run
  against the RFC, not an alternative specification.
- `whatwg-fetch/fetch.bs`, §2.2.2: the consuming get/set structured-field
  operations. Header lists and their integration remain in Fetch.

## Three implementation slices

1. **Values and serialization (§3, §4.1) — implemented.** `values.ts` retains all eight bare
   types in tagged records, with ordered Maps for dictionaries and parameters.
   `serialize.ts` owns escaping, delimiters, numeric limits, and the RFC's
   explicitly required ties-to-even decimal rounding. Integers and epoch
   seconds use exact-range JavaScript numbers; decimal rounding uses their
   shortest decimal spelling. Invalid input fails without being repaired or
   mutated. Prove the algorithms with independent expected strings and the
   HTTPWG serialization fixtures.
2. **Parsing (§4.2) — implemented.** `parse.ts` handles all three top-level
   types, parameters, whitespace, duplicate keys, and complete-input validation.
   Focused tests cover Integer versus integral Decimal identity, strict UTF-8,
   byte views, and the chosen acceptance of missing base64 padding and nonzero
   pad bits. The HTTPWG corpus adds capacity tests and retains the distinction
   between mandatory and permitted failures.
3. **Fetch integration — deferred.** Complete the structured-field get/set operations in
   [Fetch's header slice](../fetch/roadmap.md#slice-2--http-methods-headers-and-statuses).
   Test combined header lines, absent or malformed fields, serialization
   failure, and omission of empty containers. Header-specific allowed keys and
   meanings remain with the specification defining that header. This slice
   waits for Fetch's header-list infrastructure; it does not add a second
   header-list implementation here.

The shared algorithms reuse the text cursor, Infra base64, and existing UTF-8
primitives. `parseStructuredField(bytes, type)` accepts the combined field value
and returns the requested record type or `null` on failure.
`serializeStructuredField` returns an ASCII string, `undefined` to omit an empty
List/Dictionary field, or `null` on failure.

## Exit proof

`npm run test:unit -- test/struct-fields/unit` runs 219 focused cases,
544 serialization-only HTTPWG cases, all 1,591 HTTPWG parsing cases, and 727
independent serialization checks against that parsing corpus's expected values.
The fixture reader preserves JSON `1.0` as Decimal and decodes its Base32 binary
representation separately from the field's Base64 encoding. Fixture provenance
and the unchanged upstream license are in
[`test/struct-fields/fixtures/httpwg/`](../../test/struct-fields/fixtures/httpwg/README.md).

The remaining proof is Fetch integration through its own header-list operations,
as scoped in slice 3; no standalone header-list substitute belongs here.

Remove this roadmap when the shared algorithms and first consumers have those
tests and any remaining gaps have a narrower owner.
