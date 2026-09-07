# Multipart body roadmap

This folder will implement multipart encoding and parsing for Fetch body
extraction/consumption. It reuses the existing FormData entry list and File
objects; it does not define another author-facing FormData class.

**Status:** planned. The entry-list API already exists in
[XHR](../../xhr/roadmap.md); multipart bytes do not.

## Sources

- [HTML multipart encoding](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#multipart/form-data-encoding-algorithm):
  the entry-list-to-bytes algorithm and its RFC 7578 specializations.
- [RFC 7578](https://www.rfc-editor.org/rfc/rfc7578.html): form-data parts,
  names/files, ordering, and interpretation; RFC 2046 §5.1 supplies multipart
  delimiter rules and RFC 2183 supplies Content-Disposition rules.
- [Fetch §§5.2–5.3](https://fetch.spec.whatwg.org/#bodyinit-safely-extract):
  extraction, MIME type/boundary, body source/length, and `formData()` parsing.

Local sources under the [reference root](../preflight.md#local-reference-inventory)
are `whatwg-html/source`, `whatwg-fetch/fetch.bs`, and
`rfcs/rfc7578.txt`, `rfcs/rfc2046.txt`, `rfcs/rfc2183.txt`.

## Implementation order

1. **Encoding.** Use the existing entry-list values and Blob/File byte access.
   Follow HTML's line-ending conversion, encoding, name/filename escaping,
   part ordering, repeated-field handling, and boundary rules. Producing a
   request body must not accidentally mutate the author's FormData entries.
2. **Parsing.** Implement boundary and part-header processing, string/file
   results, and malformed/truncated input behavior. Apply Fetch's UTF-8 and
   Content-Type rules where they specialize the RFC. Fetch explicitly notes
   that the parsing description is incomplete: use WPT and browser source
   evidence for unresolved details, and discuss material divergences before
   establishing behavior.
3. **Body integration.** Connect encoding to extraction and parsing to
   consumption using Fetch's Body records and existing Web IDL projection.
   Preserve stream errors, unusable-body checks, lengths, and realm ownership.

Keep the RFC's wider MIME/email requirements bounded to the multipart
operations actually referenced. HTML document parsing and form-backed entry
construction remain with [HTML forms/XHR](../../xhr/roadmap.md).

## Exit proof

Test encoding and parsing against independent byte fixtures: repeated names,
empty entries/files, non-ASCII names/data, CR/LF and quote escaping, embedded
boundary-like bytes, file metadata, and malformed endings/headers. Round trips
alone can preserve matching bugs in both directions.

Then test real Body extraction/`formData()` consumption, including the
Content-Type boundary, File results, author entry-list preservation, rejected
streams, and cross-realm projection. Remove this roadmap when both algorithms
and that integration pass their focused tests.
