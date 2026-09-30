# Storage substrate roadmap

This project owns the shared algorithms and records of the
[Storage Standard](https://storage.spec.whatwg.org/). File API's Blob URLs are
the first planned consumer outside HTML Web Storage, so the substrate has its
own project. Browlet supplies environment inputs and owns the user-agent and
traversable storage instances.

**Status:** storage-key slice A is implemented. Storage backends and the
author-facing StorageManager API remain later work.

## Sources and boundaries

Local source: `whatwg-storage/storage.bs`, relative to the
[reference root](../fetch/README.md#sources).
Read §4's model before implementing §4.2 keys. Later substrate work follows
§§4–7; the §8 public API needs explicit browser integration.

- [File API](../file/ROADMAP.md#blob-url-integration)
  owns Blob URL entries, authorization, revocation, and cleanup.
- [HTML Web Storage](../browlet/storage/ROADMAP.md) owns `Storage`,
  `StorageEvent`, per-Document holders, and local/session API behavior.
- IndexedDB and Cache Storage remain later consumers. The browser HTTP cache
  has its own [Fetch plan](../fetch/ROADMAP.md#http-cache); the two cache
  concepts must not acquire one shared implementation merely by name.

## First slice — storage keys

This is **A** of the combined Storage keys/Blob URLs detour. File's roadmap
owns [B–C](../file/ROADMAP.md#blob-url-integration).

`StorageKey` in `keys.ts` owns `obtain()`, `obtainForNonStoragePurposes()`, and
`equals()`. The one-member tuple is represented by its named `origin` field.
Storage acquisition returns null for opaque origins or disabled storage;
non-storage acquisition preserves opaque-origin identity and remains available
when storage is disabled. Blob URL checks use the latter.

The narrow `StorageEnvironment` interface in `environment.ts` is implemented by
Browlet's `EnvironmentRecord` base class. Full `BrowletEnvironment` objects extend it;
no adapter object is constructed. Settings supply their security origin;
earlier records supply their creation URL.
Its `StorageUserAgent` contract supplies `storageEnabled`, read at acquisition
time, and `generateUUID()`, used by File's user-agent-owned Blob URL store.

The current standard defines an origin-only key and explicitly anticipates
partitioning changes. Keep equality in Storage even while it delegates to
origin equality; consumers must not replace it with their own origin check.
Top-level-site, ancestor-chain, and nonce partitioning need a separately
reviewed policy and input model when adopted. The current key does not claim
to reproduce those additional browser privacy partitions.

**Exit proof:** tuple and opaque origins, equal and unequal keys, settings
versus creation-URL selection, and the two acquisition operations have focused
tests, including real Window settings and pre-realm environment records.
The File-owned tests in B–C exercise those keys at the Blob URL boundary.
The Blob preflight is complete; Fetch 8C now supplies response construction and
dispatch, with the reviewed clientless-access precondition recorded in its roadmap.

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
