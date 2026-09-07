# HTTPWG structured-field fixtures

`serialisation-tests/`, the root JSON files under `parsing-tests/`, and
`LICENSE.md` are copied unchanged from
[httpwg/structured-field-tests](https://github.com/httpwg/structured-field-tests/tree/1e280c3ed9ffe0ca5fdb1d97219dddc389007677),
commit `1e280c3ed9ffe0ca5fdb1d97219dddc389007677`.

The four serialization-only files cover invalid or noncanonical values.
`must_fail` requires serialization failure; otherwise `canonical` is the
expected field value.

The 20 parsing files retain `must_fail` versus `can_fail`: mandatory failure
versus an RFC-permitted failure. Successful parsing is compared with `expected`;
that independent expected value is also serialized against `canonical` or
`raw`. The test reader preserves JSON decimal notation such as `1.0`, and
decodes the fixture's Base32 binary representation separately from the field's
Base64 representation. Focused tests cover our chosen acceptance behavior for
missing base64 padding and nonzero pad bits.

Keep upstream fixtures unmodified when refreshing them. Report disagreements
with the RFC explicitly rather than altering expected results.
