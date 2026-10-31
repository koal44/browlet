# Storage substrate roadmap

This project owns the shared algorithms and records of the
[Storage Standard](https://storage.spec.whatwg.org/). File API's Blob URLs
already consume its storage keys. Browlet supplies environment inputs and
owns the user-agent and traversable storage instances.

**Status:** §§1–4.8 are reviewed; endpoints, keys, shed ownership, legacy
session cloning, shelf/bucket creation, bottle-map acquisition, and proxy-map
forwarding are implemented, with storage tasks using HTML's event loop.
§6 supplies Web Storage usage estimates and a configurable fixed shelf quota.
§7's opening rules supply whole-bucket clearing and removal of empty shelves.
§7.1 connects session cleanup to final traversable removal; automatic storage
pressure eviction and §5 persistence permission remain deferred.
§7.2's UI guidance is reviewed; coordinated site-data controls remain host work.
§8's public StorageManager API remains deferred.

## Sources and boundaries

Local source: `whatwg-storage/storage.bs`.
§§1–3 establish scope and dependencies; their API examples are defined later.
Infra, HTML, and Web IDL already supply the shared terminology and browser
integration. Permissions integration is a dependency of the deferred §5
persistence permission and §8 `persist()` algorithm.

The current pass supplies the in-memory model needed by HTML Web Storage,
including applicable quota and clearing rules from §§6–7. Disk backing,
persistence permission, and the public StorageManager API remain deferred.

- [File API](../file/ROADMAP.md#blob-url-integration)
  owns Blob URL entries, authorization, revocation, and cleanup.
- [HTML Web Storage](../browlet/storage/ROADMAP.md) owns `Storage`,
  `StorageEvent`, per-Document holders, and local/session API behavior.
- IndexedDB and Cache Storage remain later consumers. The browser HTTP cache
  has its own [Fetch plan](../fetch/ROADMAP.md#http-cache); the two cache
  concepts must not acquire one shared implementation merely by name.

## Model overview and storage endpoints

§4 requires isolation by storage key, storage type, and endpoint. The stores
and map-acquisition operations that enforce it belong to §§4.3–4.7.
`endpoints.ts` implements §4.1's five registered endpoints, retaining their
type sets and recommended bottle quotas. `StorageEndpoint` owns that metadata
and usage accounting; `WebStorageEndpoint` supplies the string format used by
both Web Storage endpoints. The specification's endpoint set is represented
by an insertion-ordered Map keyed by identifier. `localStorage` and `sessionStorage`
each recommend 5 MiB; null leaves the other endpoints without their own limit,
but does not exempt them from the eventual shelf quota. Registration supplies
metadata; it does not implement the registered APIs or enforce quotas yet.

## Storage keys

This is **A** of the combined Storage keys/Blob URLs detour. File's roadmap
owns [B–C](../file/ROADMAP.md#blob-url-integration).

`StorageKey` in `keys.ts` owns `obtain()`, `obtainForNonStoragePurposes()`, and
`equals()`. The one-member tuple is represented by its named `origin` field.
Storage acquisition returns null for opaque origins or disabled storage;
non-storage acquisition preserves opaque-origin identity and remains available
when storage is disabled. Blob URL checks and BroadcastChannel use the latter.

The narrow `StorageEnvironmentBase` interface in `environment.ts` is implemented by
Browlet's `BrowletEnvironmentBase` base class. Full `BrowletEnvironment` objects extend it;
no adapter object is constructed. Settings supply their security origin;
reserved environments supply their creation URL.
Its `StorageUserAgent` contract supplies the local storage shed, `storageEnabled`
read at acquisition time, the fixed `storageQuotaBytes` budget, and `generateUUID()`
used by File's user-agent-owned Blob URL store.
`StorageEnvironment` extends the base with the full owner's storage maps and
task delivery. There is no separate environment object.

The current standard defines an origin-only key and explicitly anticipates
partitioning changes. Keep comparisons through `StorageKey.equals()`, including
shed lookups: separately created key objects can be equal. Consumers must not
replace that comparison with JavaScript object identity or their own origin check.
Top-level-site, ancestor-chain, and nonce partitioning need a separately
reviewed policy and input model when adopted. The current key does not claim
to reproduce those additional browser privacy partitions.

**Exit proof:** tuple and opaque origins, equal and unequal keys, settings
versus creation-URL selection, and the two acquisition operations have focused
tests, including real Window settings and reserved environments before realm creation.
Blob URL and BroadcastChannel tests exercise those keys at their consumer boundaries.
The Blob preflight is complete; Fetch 8C now supplies response construction and
dispatch, with the reviewed clientless-access precondition recorded in its roadmap.

## Storage sheds

`sheds.ts` owns sheds and shelves; `buckets.ts` owns bucket variants, and
`bottles.ts` owns endpoint data and proxy maps. `UserAgent.storageShed` holds local storage;
`Traversable.storageShed` holds session storage across Document replacements.
`StorageShed` retains Map ordering and operations, finding keys through
`StorageKey.equals()` with a linear scan rather than relying on object identity.

`StorageShed.cloneSessionStorageInto(target)` creates fresh session shelves and copies
each origin's default `sessionStorage` map. The source and destination then
mutate independently. Other buckets, endpoint data, and proxy references are
not copied; equal destination keys are replaced without clearing unrelated keys.
Top-level traversable creation resolves the opener's top-level traversable and
calls this operation with the two sheds directly; Storage needs no traversable
interface or runtime object. Auxiliary browsing-context creation is still a navigation
stub; its integration test supplies only that missing step.

Cloning reaches the shelf/bucket factories and bottle records from §§4.4–4.6,
so those small dependencies are implemented here. They initialize the default
bucket, registered endpoint bottles, quotas, and empty proxy reference sets.
The bottle-map acquisition and usable proxy views are now supplied by the §4.6
slice below. Quota enforcement remains later work.

**Exit proof:** focused tests cover key equality, clone contents and isolation,
replacement rules, browser ownership, navigation lifetime, and nested openers.

## Storage shelves

`StorageShelf.obtain(shed, env, type)` implements §4.4 by obtaining a storage
key before looking up or creating its shelf. Failure returns null without
changing the shed. Repeated acquisition reuses the shelf and its existing data;
disabling storage blocks acquisition without clearing previously stored data.
`obtainLocal(env)` selects the user agent's local shed. Shelf creation and its
default bucket were already required by §4.3's clone operation.

**Exit proof:** tests cover local/session creation and reuse, origin/shed
isolation, inherited settings origins, policy changes, and opaque-origin
failure. Browser tests reacquire shelves across real Document replacements.

## Storage buckets

The §4.5 review required no runtime changes. `StorageBucket.create(type)`
selects a local or session bucket and allocates fresh bottles for registered
endpoints supporting that type, copying each endpoint's quota. Local buckets
start in `best-effort` mode; the mode field alone does not implement permission
to persist or disk backing.

**Exit proof:** tests cover endpoint filtering, local-only retention mode,
independent data and proxy references, and quota initialization for an endpoint
supporting both types. Later registry changes leave existing bottle quotas intact.

## Storage bottles and map acquisition

`StorageBottle.obtainMap(type, env, identifier)` implements §4.6, with local
and session convenience methods. Each successful call returns a fresh
`StorageProxyMap` over the selected bottle's data and records that proxy in the
bottle's reference set. Invalid storage keys return null without adding proxies.
The identifier must name an endpoint registered for the requested type.

`StorageEnvironment` describes the full owning environment rather than reserved
clients. HTML's `getSessionStorageShed()` follows the Window's associated
Document, node navigable, and traversable at acquisition time. A non-Window or
missing node navigable violates that operation's precondition and throws an
internal error; local acquisition does not query session ownership.

User-agent ownership shares local data across modeled agents in this process;
a backend shared across actual threads or isolates remains unimplemented.

**Exit proof:** tests cover fresh proxy identity and registration, shared data,
endpoint/origin/owner isolation, policy failures, and backing-map replacement.
Browser tests cover distinct agents, same-origin descendants beneath cross-origin
ancestors, separate tabs, and data retained through Document replacement.

## Storage proxy maps

The §4.7 review required no runtime changes. `StorageProxyMap` forwards map
operations to its current backing map. It is an internal record, not a
JavaScript Proxy or the author-facing `Storage` object. Replacing one view's
backing map leaves other views unchanged; copying entries uses the current
backing map. The operation that decides when to redirect views belongs to
the consuming specification.

`StorageBottle<K, V>` and `StorageProxyMap<K, V>` retain their endpoint's key and
value types. Known local/session Web Storage map acquisition and
`StorageBucket.getBottle()` calls return string-keyed, string-valued data.
The bucket's heterogeneous bottle map retains unknown formats for unfinished
endpoints, whose populated usage still throws until accounting is implemented.

**Exit proof:** tests cover ordered reads/writes, deletion, clearing, iteration,
backing replacement, independent views, and cloning through the iterator.

## Storage tasks

§4.8's shared storage task source lives in HTML's `scripting/tasks.ts`.
`StorageEnvironment.queueStorageTask(global, steps)` routes through
the destination global's realm, retaining its Agent and associated Document.
It uses the existing event loop's ordering, checkpoints, and Document cleanup.
There is no separate storage scheduler. HTML Web Storage's `storage` events
use the DOM-manipulation source instead.

**Exit proof:** browser tests cover delivery across agents, FIFO ordering with
microtasks between tasks, Document destruction, and old Window destinations
versus a retargeted WindowProxy. StorageManager and worker/cross-thread consumers
remain outside this slice.

## Storage usage

The first part of §6 leaves usage estimates implementation-defined.
`StorageShelf.usage` totals each current bottle's estimate across all buckets;
proxy references do not multiply stored data. Estimates read the current maps,
so writes, deletion, clearing, and backing-map replacement need no usage counter.
The cost is linear in the stored entries.

Endpoints supply `estimateUsage(map)`, captured when a bottle is created.
For `localStorage` and `sessionStorage`, Browlet counts two bytes per UTF-16
code unit in both keys and values, excluding map/engine overhead. This is a
payload estimate, not a measurement of process memory or disk allocation.
Chromium's `storage_area_map.cc` uses the same key/value code-unit convention
for its Web Storage quota counter; its actual-memory counter is separate.

Empty maps contribute zero. Populated bottles without an estimator throw an
internal error rather than underreporting usage. IndexedDB, Cache Storage,
and service-worker registration accounting remain dependencies of those
unimplemented endpoints. No generic serialization or author coercion is used
to guess their size. Mutation-time quota enforcement remains unfinished;
this getter does not clamp usage to a bottle's quota.

**Exit proof:** tests cover ASCII, non-ASCII, surrogate pairs and lone
surrogates; live map changes; multiple buckets and independent shelves;
endpoint-supplied binary estimates; and explicit failure for missing accounting.

## Storage quota

§6's shelf quota is `StorageUserAgent.storageQuotaBytes`, read from the owning
browser. `BrowletConfig.storageQuotaBytes` configures it as a non-negative safe
integer. The default is 64 MiB, a Browlet in-memory policy choice. Each origin's
local shelf and each traversable's session shelves receive that budget
independently; it is not one shared pool or the remaining unused portion.
Quota does not depend on device capacity or currently available space.

The policy stays on UserAgent rather than being copied into individual shelves.
Endpoint quotas remain separate: localStorage and sessionStorage still carry
their recommended 5 MiB bottle limits. HTML §12's `Storage.setItem()` must enforce
both bottle and shelf limits before mutation; the internal maps do not do that.
The deferred StorageManager API will expose shelf usage and this quota estimate.

**Exit proof:** browser tests cover default/custom/zero budgets, invalid host
configuration, navigation lifetime, independent origins and browser instances,
and unchanged endpoint quotas.

## Storage management

§7's opening rules are implemented by `StorageBucket.clear()` and
`StorageShed.removeBucket(key, name)`. Clearing empties every bottle's current
map in place, preserving map views, endpoint metadata, and bucket membership.
Retained and newly acquired views therefore continue to share storage after
clearing. This is user-agent bucket clearing; HTML's `Storage.clear()` clears
only its own endpoint map and has separate event-delivery rules.

Removal clears the bucket, removes its entry, and removes the shelf and key
when no buckets remain. It uses storage-key equality and leaves other buckets,
origins, and sheds alone. Callers must retire the removed bucket's consumers
first; removal does not reconnect old views to later replacement storage.
Use in-place clearing when views must remain usable.

These are internal data operations, not an eviction policy or public browser
command. The browser owner must select an allowed time, normally avoiding
scripts that can access the bucket, and respect permission for persistent
storage. No automatic eviction, navigation clearing, or scheduling is added.
Future endpoint backends must extend whole-bucket clearing to their resources
and connections; emptying the current in-memory maps does not implement those APIs.

**Exit proof:** tests cover all endpoint maps, retained and newly acquired
views, usage after clearing, local/session and origin isolation, equal keys,
partial/last-bucket removal, absent entries, and fresh acquisition after removal.

## Storage pressure and session lifetime

§7.1's session rule is connected at `UserAgent.removeTopLevelTraversable()`:
after document teardown, final removal clears every bucket and shelf in that
traversable's session shed. It leaves the user agent's local shed and other
tabs' sessions untouched. Starting to close, ordinary Document destruction,
and navigation do not end the storage session. Repeated removal is harmless;
an unrelated user agent cannot clear a traversable it does not own.

The [navigation lifecycle](../browlet/browsing/navigation/ROADMAP.md) still
needs definite closing, unload cancellation, and complete history/descendant
destruction before it can call that final step. `Window.close()` is not yet
functional. Session revival/restoration is not implemented; adding it requires
a retention decision before removal rather than silently reviving cleared data.

Automatic pressure handling remains deferred: Browlet has no host pressure
signal, eviction ranking, or persistent-storage prompt. The fixed shelf quota
does not measure available host space and must not trigger eviction. A future
pressure policy must coordinate network-state cleanup with best-effort local
buckets, avoid active consumers, and request consent before clearing persistent
buckets. It must not evict session storage merely because a local quota is full.

**Exit proof:** browser-owner tests exercise final removal after active-document
destruction, retained views, multiple origins/buckets, other-tab and local-data
isolation, repeated removal, and foreign-owner rejection. Existing navigation
tests verify that replacing a Document preserves its traversable's session.

## User-interface guidelines

§7.2 needs no runtime additions in this pass. A future host UI should offer
per-website clearing that combines network state and storage, preventing
remaining network state from reviving cleared data. Saved form credentials
and feature permissions should have separate controls. Under §3's categories,
cached HTTP authentication belongs to network state, not saved form credentials.

`Browlet.clearHTTPCache()` and `clearHTTPCredentials()` are independent,
whole-browser host operations; the latter clears the HTTP authentication cache.
Neither implements coordinated per-website clearing. That operation needs
selection and cleanup across the relevant network and storage owners, including
pending writes that could repopulate cleared state. Storage-bucket clearing
alone is insufficient.

The standard intentionally leaves the meaning of an individual website to UI
policy. No grouping policy is selected here; origin-only storage keys do not
settle which related origins, cookie domains, or network partitions to clear.

## Later substrate slices

1. **§5 persistence permission:** deferred with disk backing and permission integration.
2. **§7.1 lifecycle/host dependencies:** finish closing in HTML; defer host
   pressure detection, eviction policy, and persistent-storage prompts.
3. **§7.2 host controls:** choose site grouping and coordinate network/storage
   cleanup when a user-facing site-data operation is introduced.
4. **§8 browser API integration:** scope StorageManager/navigator exposure
   with its browser owner before adding declarations or implementation objects.

Each later slice needs its consumer's identity, isolation, failure, and
lifecycle tests. Do not create empty service layers merely to reserve these
future features. Remove this roadmap when reached substrate contracts are
implemented and surviving work has a narrower owner.
