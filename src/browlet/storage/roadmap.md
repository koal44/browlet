# Web Storage roadmap

This roadmap owns HTML §12's synchronous `Storage`/`StorageEvent` API and its
browser integration. The separate [Storage substrate roadmap](../../storage/roadmap.md)
owns the Storage Standard's records, key algorithms, maps, and backend work.
Browlet supplies the browser lifetime and policy even when backing is in memory.

## Early constraints

- The public `Storage` API itself is not part of the first Document lifecycle.
  Shared storage keys arrive first for Blob URLs; shared-worker discovery and
  `BroadcastChannel` are later consumers of that same substrate.
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

Consume the shared substrate's local/session map acquisition, policy results,
and clone operations. Browser composition owns its instances; this folder
does not implement a second key or backing-store model. The independent
project is justified by File API needing keys before Web Storage is complete.

Blink likewise separates HTML-facing Window/Storage wrappers in
`modules/storage` from browser-process storage namespaces and backing areas.
Its cached wrappers are useful evidence for the identity split, not a reason to
copy its multiprocess IPC architecture into Browlet.

## Delivery order

1. Connect the shared key/map operations when their browser consumers exist;
   follow the substrate roadmap for implementing those operations.
2. Connect traversable session-storage ownership and opener cloning with
   auxiliary browsing contexts.
3. Build realm-bound Storage objects over the substrate's local/session maps;
   add Web IDL named properties, policy/quota errors, and cross-global events.
4. Integrate substrate persistence/quota results with the same synchronous
   HTML facade when an actual persistent-storage consumer exists.

## Removal condition

Burn this file after storage-key consumers, session-history ownership, public
Storage behavior, cross-global events, policy failures, and persistence all
have implemented owners or narrower surviving roadmaps.
