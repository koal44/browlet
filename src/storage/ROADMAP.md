# Storage substrate roadmap

This project will own the shared algorithms and records of the
[Storage Standard](https://storage.spec.whatwg.org/). File API's Blob URLs are
the first planned consumer outside HTML Web Storage, so the substrate has its
own project. Browlet supplies environment inputs and owns the user-agent and
traversable storage instances.

**Status:** planned. The first slice is storage keys, not a complete storage
backend or a new author-facing API.

## Sources and boundaries

Local source: `whatwg-storage/storage.bs`, relative to the
[reference root](../fetch/PREFLIGHT.md#local-reference-inventory).
Read §4's model before implementing §4.2 keys. Later substrate work follows
§§4–7; the §8 public API needs explicit browser integration.

- [File API](../file/ROADMAP.md#slice-4--blob-url-store-and-urlfetch-integration-deferred)
  owns Blob URL entries, authorization, revocation, and cleanup.
- [HTML Web Storage](../browlet/storage/ROADMAP.md) owns `Storage`,
  `StorageEvent`, per-Document holders, and local/session API behavior.
- IndexedDB and Cache Storage remain later consumers. The browser HTTP cache
  has its own [Fetch plan](../fetch/http/cache/ROADMAP.md); the two cache
  concepts must not acquire one shared implementation merely by name.

## First slice — storage keys

Implement the storage-key record and obtain/compare algorithms in `keys.ts`.
Distinguish obtaining a key for storage from obtaining one for non-storage
purposes: the former can fail for opaque origins or disabled storage; Blob
URL checks use the latter.

Browlet selects the required environment-settings or creation-URL input;
the shared project consumes existing URL/origin records. The current standard
defines an origin tuple and explicitly anticipates partitioning changes.
Keep one Storage-owned comparison operation, rather than allowing each
consumer to substitute its own origin check or invent extra partition fields.

**Exit proof:** tuple and opaque origins, equal and unequal keys, settings
versus creation-URL selection, and the two acquisition operations have focused
tests. The File-owned tests then exercise those keys at the Blob URL boundary.
Implementing keys alone does not complete Blob URL lifetime or Fetch support.

## Later substrate slices

1. **§4 stores and maps:** endpoints, sheds, shelves, buckets, bottles, proxy
   maps, and local/session map acquisition when a consumer needs them.
   Preserve user-agent versus traversable ownership and the specified clone
   rules; do not put all backing state in module scope.
2. **§§5–7 policy/backend work:** persistence permission, usage/quota, and
   management operations with actual host decisions and a replaceable backend.
3. **§8 browser API integration:** scope StorageManager/navigator exposure
   with its browser owner before adding declarations or implementation objects.

Each later slice needs its consumer's identity, isolation, failure, and
lifecycle tests. Do not create empty service layers merely to reserve these
future features. Remove this roadmap when reached substrate contracts are
implemented and surviving work has a narrower owner.
