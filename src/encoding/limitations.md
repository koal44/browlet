# Encoding implementation notes

## HTML encoding adapter

`ACCOMMODATION(exodus-html-encode)` in `hooks.ts`: Encoding §6.2's `encode`
operation needs HTML error handling (decimal character references for
unrepresentable characters). `@exodus/bytes` 1.15.1 exposes this through its
public URL percent-encoding helper, while its direct legacy encoders only
offer fatal errors. `encode` reverses that helper's percent escaping to obtain
the original bytes, including stateful encoding transitions. Literal percent
signs are escaped before this reversal. UTF-8 uses the existing direct encoder.

The public `createSinglebyteEncoder` and `createMultibyteEncoder` options accept
only `{ mode: 'fatal' }`, including their Node variants. Internally,
`fallback/multi-byte.js` has an `onError` callback used by `whatwg.js`, but that
module is not a public package export. A Node probe confirmed that a resolved
file URL can import it, but using it directly still requires assembling the
character-reference output and handling single-byte encodings separately.
That would expand this adapter. A direct HTML encoding hook in Exodus would
let us reuse its charset tables and state machines without this adapter.

This preserves the required output at the cost of an intermediate ASCII string
for legacy encodings. Focused Encoding tests cover literal escapes, numeric
references, and ISO-2022-JP transitions. Replace this adapter with a direct call
and remove the percent-escape reversal when the dependency exposes an encoder
with HTML error handling.
