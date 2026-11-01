# Web Storage roadmap

This roadmap owns HTML §12's synchronous `Storage`/`StorageEvent` API and its
browser integration. The separate [Storage substrate roadmap](../../storage/ROADMAP.md)
owns the Storage Standard's records, key algorithms, maps, and backend work.
Browlet supplies the browser lifetime and policy even when backing is in memory.

## §§12.1–12.2.1: Storage reads

§12.1 is introductory. The first API slice installs the Window-only, nonconstructible
`Storage` interface. [StorageImpl](storage.ts) retains its existing proxy map,
local/session type, and relevant Window environment. `length`, `key()`, `getItem()`,
and supported property names read the current map; no second backing store or key
cache is introduced. Keys follow that map's order. Binding supplies conversion,
receiver checks, realm ownership, enumeration, and inherited-name visibility.
For example, a stored `length` remains readable through `getItem('length')` without
replacing the length attribute.

Read tests acquire Storage through the public Window getters and exercise it
through author code; their fixtures seed the underlying bottle maps independently
of the write tests.

## §12.2.1: Writes and quota

`setItem()` and named-property assignment use the same implementation. Binding
converts both arguments before entry. Equal values return without broadcasting;
other writes check capacity before changing the map, then use the existing
broadcast path. Replacements preserve key position; new keys append.

Acquired proxy maps retain their bottle and shelf for quota accounting, rather
than looking them up again through the Window's current settings. Writes enforce
the bottle limit (normally 5 MiB) and UserAgent's configured per-shelf budget.
`WebStorageEndpoint.entrySize()` shares the substrate's UTF-16 byte accounting;
replacement charges only the difference, including the key only for a new entry.
Following Chromium's `StorageAreaMap::SetItemInternal`, non-growing changes remain
allowed when an existing area is over budget. Growing writes measure current
usage; totals are not separately cached.

Tests cover author conversion and named writes, atomic bottle/shelf rejection,
UTF-16 boundaries, usage across buckets and endpoints, removal freeing space,
retained receivers after navigation, and insert/update event snapshots. Populated
endpoints without an estimator remain an explicit accounting dependency; they
cannot silently contribute zero to a shared shelf check.

## §12.2.1: Removal and broadcast

`removeItem()`, named-property deletion, and `clear()` change the existing map
and broadcast only when data changed. Deletion preserves the surviving keys'
Map insertion order, an allowed implementation-defined reorder policy. Missing
keys and already-empty maps produce no events.

Each Storage registers a weak reference with its UserAgent. Broadcast selects
other live objects of the same type and origin; session recipients must also
belong to the same traversable. This includes Storage objects retained after
Document replacement, which a scan of current Document holders would miss.
The registry neither owns storage data nor keeps the objects or globals alive.

The source URL and changed values are captured when broadcasting. Each recipient
gets its own trusted `StorageEvent`, with its own Storage as `storageArea`, on
the DOM-manipulation task source. Existing task eligibility holds delivery while
the recipient Document is not fully active. Blink likewise uses the recipient
Storage object and DOM-manipulation delivery in `StorageArea::EnqueueStorageEvent`.

Window's `onstorage` attribute and `addEventListener('storage', ...)` both receive
these broadcasts. Window composes `WindowEventHandlersMixin`, which delegates
handler identity, listener ordering, replacement, deactivation, and return-value
rules to the existing `EventHandlerMap`. Installing a handler does not acquire
a Storage object. This first mixin slice declares only `onstorage`; body/frameset
aliases, content-attribute compilation, and the other Window handlers remain
HTML §§4 and 8 dependencies. All recipients currently live in one Node runtime;
cross-thread/process storage synchronization remains a backend dependency.

## §§12.2.2–12.2.3: Window storage getters

Window's local/session mixins expose readonly `localStorage` and `sessionStorage`
on both HTTP and HTTPS origins. Window composes `WindowSessionStorageMixin` and
`WindowLocalStorageMixin` and forwards its getters to them. Each mixin returns
the associated Document's cached holder, or acquires a bottle proxy map through
the relevant environment and retains a new `StorageImpl`. Binding projects it
in the receiver's realm. Document owns the nullable holders; acquisition stays
in the storage mixins, keeping DOM's Storage dependency type-only.

Opaque origins and denied storage policy throw `SecurityError` without caching
a holder. A later access can retry acquisition. Once cached, the specified
getters return that holder before consulting policy again. Holders belong to the
Document, so replacing an initial Document also replaces Storage identity when
navigation reuses its Window. Equivalent maps remain shared across same-origin
Documents: local storage within a UserAgent, session storage within a traversable.

Tests cover denial/retry, borrowed getters, cross-origin rejection, navigation,
and local/session sharing. The tab/child fixture composes existing browsing
records directly; automatic iframe creation and auxiliary-context setup remain
navigation dependencies. The holders share the substrate's existing maps.

## §12.2.4: StorageEvent dependency

§12.2.1's broadcast algorithm needs this interface. [StorageEventImpl](events/storage-event.ts)
implements its constructor data and legacy `initStorageEvent()` over the existing
Event base. Binding converts the dictionary and arguments, projects `storageArea`
with its existing identity, and allocates events in the receiving realm. Document's
existing legacy factory also recognizes `StorageEvent`.

`events/` is a separate component below DOM nodes and the storage implementation.
Document imports its narrow barrel; the event retains only a type reference to
`StorageImpl`. Storage's `web-idl.ts` still collects the feature's declarations.

Reinitialization is ignored during dispatch. Otherwise it resets the Event state
and storage fields while preserving timestamp and composed, as `initEvent()` does;
Blink uses the same sequence in `modules/storage/storage_event.cc`.

Writes, removal, and clearing use this interface for broadcast delivery.
The trusted-event and `onstorage` identity regressions pass through shared
Window/Binding conversion: `event.target === window` and the handler's
`this === window` are true. StorageEvent and event dispatch retain their
implementation targets; neither owns a special projection rule.

## §12.3: Privacy

The tracking mitigations listed here are user-agent policy choices. Browlet's
storage keys are currently origin-only: third-party partitioning/blocking,
expiry, per-site access lists, and tracking metadata are not implemented.
`storageEnabled` can deny new acquisition, but does not revoke already-cached
Document holders. A coordinated host operation for clearing cookies and storage
together remains an integration dependency.

For sensitive data, `removeItem()`, `clear()`, and substrate bucket clearing
immediately remove entries from the shared backing maps. Retained views see the
deletion. Final traversable removal clears its session storage. A future disk
backend must preserve prompt deletion; the current backend is entirely in memory.

## §12.4: Security

Storage uses strict origin equality, including scheme, host, and port. Paths,
queries, fragments, and `document.domain` relaxation do not change storage
ownership. Different directories on the same origin intentionally share data;
there is no path-level access boundary. The author-level origin tests exercise
both reads and overwrites through local/session storage across navigation.

DNS-spoofing protection belongs to the HTTPS transport, whose Node connector
keeps certificate and hostname verification enabled. The storage tests supply
documents through Browlet's route fixture and verify origin isolation, not TLS.
These sections require no additional storage algorithm for the in-memory backend;
the privacy policies and integration dependencies above remain open.

## Early constraints

- Shared storage keys serve Web Storage, Blob URLs, and `BroadcastChannel`; shared-worker
  discovery remains a later consumer of that same substrate.
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
  `setItem()` must check the bottle quota and the browser's per-shelf
  `storageQuotaBytes` budget before changing data. Shared internal maps do not
  enforce these limits; a rejected write must leave the old value intact.
- HTML deliberately supplies no cross-agent locking guarantee for
  `localStorage`. Do not invent one as observable API behavior merely because
  an in-process implementation can serialize access.

## Planned Browlet ownership

| Source | Contract | Specification |
| --- | --- | --- |
| `storage.ts` | Reads, atomic writes with quota checks, removal/clearing, named operations, and queued broadcasts over a proxy map | HTML §12.2.1; Web IDL legacy platform objects |
| `events/storage-event.ts` | `StorageEvent`, initialization dictionary, and legacy initializer | HTML §12.2.4 |
| `window-session-storage.ts`, `window-local-storage.ts` | Composed mixin implementations and declarations; lazy acquisition, denial checks, and per-Document caching | HTML §§12.2.2–12.2.3 |
| `web-idl.ts` | Registers `Storage`, `StorageEvent`, its dictionary, and Window local/session mixins | HTML §12.2 |
| existing Document and Window modules | Document retains the holders; Window composes the storage mixins and forwards its getters | HTML §§12.2.2–12.2.3 |
| existing UserAgent | Weak discovery of live Storage recipients, including retained objects outside the current Document holders | HTML §12.2.1 |

Consume the shared substrate's local/session map acquisition, policy results,
and clone operations. Browser composition owns its instances; this folder
does not implement a second key or backing-store model. The independent
project is justified by File API needing keys before Web Storage is complete.

Blink likewise separates HTML-facing Window/Storage wrappers in
`modules/storage` from browser-process storage namespaces and backing areas.
Its cached wrappers are useful evidence for the identity split, not a reason to
copy its multiprocess IPC architecture into Browlet.

## Delivery order

1. Finish WindowEventHandlers' body/frameset aliases and content attributes with
   HTML's element and handler integrations; Window's IDL `onstorage` is connected.
2. Complete auxiliary browsing-context creation. Traversable shed ownership
   and the opener-clone call are implemented; the earlier navigation stub still
   prevents that flow from running end to end.
3. Integrate substrate persistence/quota results with the same synchronous
   HTML facade when an actual persistent-storage consumer exists.

## Removal condition

Burn this file after storage-key consumers, session-history ownership, public
Storage behavior, cross-global events, policy failures, and persistence all
have implemented owners or narrower surviving roadmaps.
