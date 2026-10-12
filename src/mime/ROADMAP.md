# MIME follow-up

The reached MIME Sniffing algorithms are implemented. This is a temporary
design note for the loader integration, not a plan to expand the standalone
MIME project. Burn it after the loader settles these choices.

## Current boundary

`MIMEType` is a realm-neutral structural value. MIME owns parsing,
serialization, grouping, supplied-type detection, and sniffing algorithms.
The resource owner collects the bounded header and retains complete chunks
for subsequent body consumption. MIME defines the 1445-byte prefix limit;
the reader owns its collection and deadline.
Browlet does not yet have the loader that can answer the
specification's user-agent question: whether it can interpret a resource of a
given MIME type and present it.

The low-level algorithms therefore receive `SupportsMIMEType` explicitly.
Tests repeat that argument because they call those algorithms directly. A
production loader should retain or close over the capability instead of making
every loader call site supply it.

The first integration now exists in Browlet's
[`ResourceReader`](../browlet/loader/resource-reader.ts). It retains the response
metadata, supplies its UserAgent's support predicate to `sniffMIMEType()`,
and passes all inspected bytes to the eventual consumer. The streamed HTML
tests exercise this path with supplied and sniffed types. The support predicate
itself remains provisional, and general handler dispatch is still absent;
those gates keep this note relevant.

`preservedMIMEType()` implements §7's initial HTML/XML rule, so a reader can
return those supplied types without acquiring bytes. Other resources collect
a header before calling `sniffMIMEType()` once. Both functions are synchronous
and share the same preservation rule. No stateful MIME collector is needed.

`detectSuppliedMIMEType()` accepts the last HTTP Content-Type field as an
unchanged isomorphic byte string. This preserves the exact Apache-bug spelling
and non-ASCII parameter bytes without encoding and decoding Fetch's stored
value. Non-HTTP resource owners supply their already-parsed type.

## Revisit with the loader

### MIME type value

Consider making `MIMEType` a class if doing so improves invariants and
discoverability. Static methods could parse strings and bytes; instance
properties or methods could expose the essence, serialize to strings or bytes,
and answer classifications determined entirely by the value.

Keep user-agent support out of the MIME type instance. In particular, do not
have integration create a distinct MIME type class closed over one Browlet
instance's support policy. A parsed value can pass through Fetch or another
shared subsystem and later be consumed by a different Browlet instance or by a
Document with different settings. Decoder availability, plugins, and resource
overrides can also change independently of the value. Binding support to the
value would either produce the wrong answer or create incompatible class
identities at those boundaries.

### Support capability

ResourceReader supplies its UserAgent's support predicate during determination.
Do not install a mutable module singleton or put the capability on a realm,
Binding Context, or RealmExecution. Context-specific sniffing remains in the
standalone functions until its element or loader callers establish the needed
input lifetime; the general resource path need not anticipate those consumers.

The concrete support implementation belongs at Browlet's composition boundary.
It should combine the document, image, media, plugin, and other resource
handlers that Browlet actually provides. If support proves dependent on a
Document, URL, settings, or invocation, preserve that input rather than
freezing the first answer into a long-lived resource reader.

### Resource metadata

The specification's associated resource metadata can return as state owned by
a real loader resource record. That owner can retain the supplied MIME type,
Apache-bug flag, no-sniff policy, resource header, and computed MIME type as
each becomes available. The standalone MIME project should not manufacture a
partially initialized resource merely to hold those fields.

The pure functions return results instead of mutating an abstract resource.
Keep that reviewed callable shape instead of adding a second resource owner.

## Removal condition

Delete this file after the first real document or subresource loader establishes
the MIME type representation, support capability lifetime, and loader-owned
resource state.
