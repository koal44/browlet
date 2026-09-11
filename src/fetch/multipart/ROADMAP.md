# Multipart body roadmap

This folder owns multipart encoding and parsing for Fetch body
extraction/consumption. It reuses the existing FormData entry list and File
objects; it does not define another author-facing FormData class.

**Status:** slices 1 (encoding) and 2 (parsing) implemented. Fetch Body integration
remains planned. The entry-list API already exists in [XHR](../../xhr/ROADMAP.md).

## Sources

- [HTML multipart encoding](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#multipart/form-data-encoding-algorithm):
  the entry-list-to-bytes algorithm and its RFC 7578 specializations.
- [RFC 7578](https://www.rfc-editor.org/rfc/rfc7578.html): form-data parts,
  names/files, ordering, and interpretation; RFC 2046 §5.1 supplies multipart
  delimiter rules and RFC 2183 supplies Content-Disposition rules.
- [Fetch §§5.2–5.3](https://fetch.spec.whatwg.org/#bodyinit-safely-extract):
  extraction, MIME type/boundary, body source/length, and `formData()` parsing.
- Content-Disposition's small grammar dependency: [RFC 2045 §5.1](https://www.rfc-editor.org/rfc/rfc2045#section-5.1)
  defines tokens and parameters; [RFC 822 §§3.2–3.4](https://www.rfc-editor.org/rfc/rfc822#section-3.2)
  defines folding, comments, and quoted pairs. These do not require a mail parser.

Local sources under the [reference root](../PREFLIGHT.md#local-reference-inventory)
are `whatwg-html/source`, `whatwg-fetch/fetch.bs`, and
`rfcs/rfc7578.txt`, `rfcs/rfc2046.txt`, `rfcs/rfc2183.txt`.

## Implementation order

1. **Encoding — implemented.** Use the existing entry-list values and Blob/File byte access.
   Follow HTML's line-ending conversion, encoding, name/filename escaping,
   part ordering, repeated-field handling, and boundary rules. Producing a
   request body must not accidentally mutate the author's FormData entries.
2. **Parsing — implemented.** Parse complete bodies into string/File entries
   with Fetch's UTF-8 and Content-Type rules. The strict rejection policy and
   remaining specification gaps are recorded below.
3. **Body integration — deferred to [Fetch Slice 6](../ROADMAP.md#slice-6--network-independent-platform-apis).**
   Connect encoding to extraction and parsing to consumption using Fetch's Body
   records and existing Web IDL projection.
   Preserve stream errors, unusable-body checks, lengths, and realm ownership.
   Use the encoder's boundary and byte length during extraction, then read its
   retained data as the body stream is consumed.

Keep the RFC's wider MIME/email requirements bounded to the multipart
operations actually referenced. HTML document parsing and form-backed entry
construction remain with [HTML forms/XHR](../../xhr/ROADMAP.md).

## Encoding contract

`encodeMultipartFormData(entries, encoding)` in `encode.ts` synchronously
returns `{ boundary: string, data: BlobData }`. It encodes names, headers, and
text immediately, composing those bytes with the Files' existing immutable
byte sources. It captures the entry list and file metadata without mutating
the inputs or reading File contents.

The encoder generates the boundary internally with `crypto.randomUUID()`.
Following the browser arrangement, it relies on random generation rather than
scanning File contents for collisions or retrying candidate boundaries. The
generated boundary can be used unquoted in Content-Type, whose construction
belongs to Fetch.

`data.size` supplies the exact encoded length immediately. `data.read()` reads
the complete body later; `data.read(start, length)` reads only the requested
range, touching File sources only where that range overlaps them. File read
failures propagate at consumption time. This reuses File's backing-data
operations without creating a platform Blob or a substitute Fetch stream API.

## Parsing contract

`parseMultipartFormData(bytes, mimeType, runtime)` in `parse.ts` consumes a
complete byte sequence backed by an `ArrayBuffer` and a parsed `MIMEType`.
It returns `FormDataEntry[]`, constructing `FileImpl` values directly with the
consuming runtime. File bytes are copied; text is decoded as UTF-8 without BOM stripping.
Entry order and repeated names are preserved. Fetch's future Body consumer owns
FormData construction, File realm ownership, and realization of a parsing
TypeError in its realm. The required realm tests are recorded in
[Fetch Slice 6](../ROADMAP.md#slice-6--network-independent-platform-apis).

Framing follows RFC 2046: case-sensitive boundaries, CRLF delimiters, transport
padding, ignored preamble/epilogue, and an optional CRLF after the closing
delimiter. Empty FormData's closing-only serialization is also accepted.
Malformed/truncated input rejects the whole parse. The agreed strict policy
also rejects ambiguous duplicate disposition parameters or Content-Disposition/
Content-Type headers instead of selecting one. Browser recovery quirks remain
outside this slice.

## Specification findings

- **HTML specializes the MIME rules.** Its §4.10.22.8 requires CRLF
  normalization for names and string values, but not filenames. After
  character encoding, only CR, LF, and quotation marks are percent-escaped
  in names/filenames; literal percent signs, backslashes, and non-ASCII bytes
  remain. Non-file parts have no Content-Type header. These rules govern
  browser output instead of applying the RFC's general encoding suggestions.
- **Missing Encoding hook, supplied here.** HTML calls Encoding §6.2's
  `encode` operation with HTML error handling. Our wrapper lacked it, and the
  installed library exposes that behavior indirectly. The small adapter and
  its replacement condition are documented in
  [Encoding's implementation notes](../../encoding/LIMITATIONS.md).
- **Empty bodies are underspecified by the referenced grammar.** RFC 2046
  §5.1.1 requires a first body-part, while an HTML FormData entry list can be
  empty. We emit only `--boundary--\r\n`, matching all three browser engines:
  [Blink's `EncodeMultiPartFormData`](https://github.com/chromium/chromium/blob/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/core/html/forms/form_data.cc#L347),
  [WebKit's `appendMultiPartKeyValuePairItems`](https://github.com/WebKit/WebKit/blob/713192fabebfdd2955aa596c262c33bfbf3d50be/Source/WebCore/platform/network/FormData.cpp#L287),
  and [Gecko's `GetSubmissionBody`](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/dom/html/HTMLFormSubmission.cpp#L370)
  append the closing delimiter unconditionally. This was checked in local
  source, including the delimiter builders and FormData callers; no live
  browser oracle was run. The independent empty-list fixture records the output.
- **Form construction is separate.** RFC 7578's `_charset_` convention is
  handled by HTML's construct-the-entry-list algorithm for hidden controls.
  This encoder preserves already-constructed entries, including that name.
- **Fetch specializes parsing.** Text always uses UTF-8, retaining a leading
  BOM and replacing malformed sequences, regardless of a part's Content-Type,
  charset parameter, or `_charset_` entry. A filename parameter, including an
  empty one, creates a File; its type defaults to `text/plain` only when the
  header is absent. The existing File implementation handles type normalization.
  Header names/filenames use UTF-8 and quoted-pair unescaping; percent escapes
  and character references remain literal. Deprecated transfer encodings and
  `filename*` are not interpreted, and nested multipart/mixed parts are not
  recursively expanded. Ordinary non-file parts follow Fetch's text rule.
- **Browser error recovery differs.** WebKit's `FetchBodyConsumer::packageFormData`
  ignores a failed part parse, whereas Blink's `FetchDataLoaderAsFormData` and
  Gecko's `FormDataParser` fail the operation. Source inspection informed the
  strict policy above; browser behavior is not substituted for Fetch's rules.
- **Fetch still has gaps.** Its FormData extraction step marks body length
  as unclear (HTML issue 6424), and its parsing description remains an
  approximation. Streamed Body integration stays in slice 3; the bounded
  parser does not claim a settled browser-compatibility algorithm for every
  malformed input or the RFC's wider mail/legacy extensions.

## Exit proof

Encoding has 21 focused tests in `test/fetch/multipart/encode.test.ts`,
plus 11 Encoding hook tests. They cover exact output bytes, names versus
filenames, literal escapes, UTF-8/legacy encodings, binary Files, generated
boundary/header agreement, immediate length, deferred File reads, retained
entries/metadata/byte sources, and read failure propagation. The deferred-read
regression failed before changing the encoder: preparation invoked the File
source's reader once.
Parsing has 53 focused tests in `test/fetch/multipart/parse.test.ts`, using
independent byte fixtures for repeated entries, UTF-8/BOM handling, charset
overrides, binary File bytes/metadata, header syntax, framing,
and malformed input. Framing cases include those from WPT's
`fetch/api/response/response-form-data.html` and
`fetch/content-type/multipart-malformed.any.js`; this is unit coverage of those
cases, not a browser WPT run. The missing delimiter-CRLF regression was observed
failing before tightening the header/body offset check.

The multipart/File test run passes all 99 tests; lint/typecheck also passes.

Then test real Body extraction/`formData()` consumption, including the
Content-Type boundary, File results, author entry-list preservation, rejected
streams, and cross-realm projection. Remove this roadmap when both algorithms
and that integration pass their focused tests.
