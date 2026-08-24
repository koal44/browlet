# Web Storage roadmap

HTML §12 owns the synchronous author-facing `Storage`/`StorageEvent` API. The
separate Storage Standard owns storage keys, sheds, shelves, buckets, bottles,
proxy maps, and the algorithms that obtain local and session storage maps.
Browlet should preserve that boundary even if both parts initially use an
in-memory backend.

## Early constraints

- The public `Storage` API itself is not part of the first Document lifecycle.
  Storage-key derivation arrives earlier: HTML shared-worker discovery and
  `BroadcastChannel` both use a storage key for non-storage purposes.
- `sessionStorage` is scoped to an origin within one top-level traversable.
  Creating an auxiliary top-level traversable with an opener legacy-clones the
  opener's traversable storage shed. Browsing triggers that transition; the
  storage substrate owns the shed and clone semantics.
- `localStorage` is selected through the relevant settings object's storage
  key. It must not be implemented as one process-wide origin-to-map table.
- A Document caches separate local- and session-storage holder objects. Public
  wrapper identity is therefore per Document/global even when multiple
  wrappers reach an equivalent backing map.
- `Storage` is a named-property legacy platform object. Its getter, setter,
  deleter, supported property names, and method behavior should use the Web IDL
  exotic-object machinery already implemented, not a second hand-written
  Proxy protocol in this subsystem.
- Mutations are synchronous and atomic from the calling script's perspective.
  An asynchronous database cannot sit directly underneath `setItem()` without
  a synchronous authoritative view and a separate persistence path.
- A successful mutation queues `storage` events only for other equivalent
  `Storage` objects. Session events additionally require the same top-level
  traversable; delivery uses the DOM-manipulation task source and the target
  realm's own `Storage` wrapper. Documents that are not fully active retain
  gated tasks rather than receiving the event immediately.
- Opaque origins and denied policy produce `SecurityError`; inability to store
  a value produces `QuotaExceededError`. Quota, persistence, partitioning, and
  user policy belong below the HTML facade.
- HTML deliberately supplies no cross-agent locking guarantee for
  `localStorage`. Do not invent one as observable API behavior merely because
  an in-process implementation can serialize access.

## Planned Browlet ownership

| Planned source | Contract | Specification |
| --- | --- | --- |
| `storage.ts` | Realm-bound `Storage` facade, local/session type, proxy-map access, key ordering, named properties, and mutations | HTML §12.2.1; Web IDL legacy platform objects |
| `storage-event.ts` | `StorageEvent`, initialization dictionary, legacy initializer, and queued broadcast delivery | HTML §§12.2.1 and 12.2.4 |
| `web-idl.ts` | `Storage`, `StorageEvent`, dictionaries, and Window local/session mixins | HTML §12.2 |
| existing Document and Window modules | Per-Document holders and lazy `sessionStorage`/`localStorage` wrapper creation | HTML §§12.2.2–12.2.3 |

The Storage Standard substrate must provide storage-key derivation, traversable
and user-agent storage sheds, local/session bottle-map acquisition, proxy maps,
quota/persistence policy, and legacy shed cloning. Start it behind a narrow
interface; promote it to a sibling `src/storage` project if IndexedDB, Cache
Storage, or another consumer needs the same implementation before Web Storage
is complete.

Blink likewise separates HTML-facing Window/Storage wrappers in
`modules/storage` from browser-process storage namespaces and backing areas.
Its cached wrappers are useful evidence for the identity split, not a reason to
copy its multiprocess IPC architecture into Browlet.

## Delivery order

1. Implement storage keys and partition inputs when SharedWorker or
   BroadcastChannel first needs them; no public `Storage` object is required.
2. Add traversable session-storage sheds and opener cloning with auxiliary
   browsing contexts.
3. Add in-memory local/session proxy maps, realm-bound wrappers, Web IDL named
   properties, policy/quota errors, and cross-global event delivery.
4. Add persistence and quota management behind the same synchronous HTML
   facade when an actual persistent-storage consumer exists.

## Removal condition

Burn this file after storage-key consumers, session-history ownership, public
Storage behavior, cross-global events, policy failures, and persistence all
have implemented owners or narrower surviving roadmaps.
