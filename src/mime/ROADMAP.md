# MIME follow-up

The reached MIME Sniffing algorithms are implemented. This is a temporary
design note for the loader integration, not a plan to expand the standalone
MIME project. Burn it after the loader settles these choices.

## Current boundary

`MIMEType` is a realm-neutral structural value. MIME owns parsing,
serialization, grouping, supplied-type detection, header collection, and
sniffing algorithms. Browlet does not yet have the loader that can answer the
specification's user-agent question: whether it can interpret a resource of a
given MIME type and present it.

The low-level algorithms therefore receive `SupportsMIMEType` explicitly.
Tests repeat that argument because they call those algorithms directly. A
production loader should retain or close over the capability instead of making
every loader call site supply it.

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

### Configured sniffing

The initial integration can close over the capability without adding another
production abstraction:

```ts
const sniff = (
  detection: SuppliedMIMETypeDetection,
  resourceHeader: Uint8Array,
  noSniff: boolean,
) => sniffMIMEType(
  detection,
  resourceHeader,
  noSniff,
  supportsMIMEType,
);
```

If several configured operations emerge, promote that closure to a
`MIMESniffer` class. Construct it for the loader or Browlet instance with the
actual support capability; do not install a mutable module singleton or put
the capability on a realm, Binding Context, or Runtime Context. Context-specific
sniffing operations may live on that class when the resulting API is more
cohesive, even when an individual operation does not consult the capability.

The concrete support implementation belongs at Browlet's composition boundary.
It should combine the document, image, media, plugin, and other resource
handlers that Browlet actually provides. If support proves dependent on a
Document, URL, settings, or invocation, preserve that input rather than
freezing the first answer into a long-lived sniffer.

### Resource metadata

The specification's associated resource metadata can return as state owned by
a real loader resource record. That owner can retain the supplied MIME type,
Apache-bug flag, no-sniff policy, resource header, and computed MIME type as
each becomes available. The standalone MIME project should not manufacture a
partially initialized resource merely to hold those fields.

A configured sniffer removes the repeated implementation capability parameter,
but it does not make the implementation identical to the specification's
abstract mutate-the-resource algorithms. Prefer the clearest loader boundary
over eliminating that harmless callable-shape difference.

## Removal condition

Delete this file after the first real document or subresource loader establishes
the MIME type representation, support capability lifetime, configured sniffing
API, and loader-owned resource state.
