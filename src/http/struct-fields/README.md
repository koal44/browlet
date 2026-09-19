# Structured fields

[RFC 9651](https://www.rfc-editor.org/rfc/rfc9651.html) values, parsing, and
serialization. Fetch owns header-list integration; each consuming specification
owns the meaning of its headers.

- `parseStructuredField(bytes, type)` accepts a combined field value and returns
  a tagged record or `null` on failure. Tags preserve distinctions such as an
  Integer versus an integral Decimal; Maps retain dictionary/parameter order.
- `serializeStructuredField(field)` returns an ASCII string, `undefined` to omit
  an empty List/Dictionary, or `null` on failure. It does not mutate the input.

Tests: `npm run test:unit -- test/http/struct-fields`. The
[HTTPWG fixtures](../../../test/http/struct-fields/fixtures/httpwg/README.md)
provide independent expected values and strings, with provenance and license.
