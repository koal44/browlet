# Permissions roadmap

Source: [Permissions](https://w3c.github.io/permissions/), Editor's Draft
26 October 2026. §§1–2 are introductory; §3's model contains normative work.

## Ownership

Each environment owns one `PermissionsImpl`, also exposed through Navigator's
binding. It owns state lookup, requests, option selection, and query dispatch.
`PermissionFeature` owns feature rules and query/revocation algorithms;
`PermissionStore` owns recorded decisions and automation application.
`UserAgent.setPermission()` is the browser's automation entry point.

One `PermissionEnvironment` and one `PermissionUserAgent` describe these existing
owners. The environment answers policy and Document activity questions without
exposing a Document to this subsystem. Binding still owns descriptor conversion,
platform identity, and result allocation. There is no separate Permissions realm.

## §§3.1–3.2: states and permission store

`store.ts` supplies `PermissionState`, the default `prompt` state, converted
descriptor/entry records, and `PermissionStore`. `UserAgent.permissionStore`
owns one initially empty store across its environments. Equal descriptor/key
pairs replace entries in their existing list position; removal preserves other
entries. An absent entry returns null, separately from an explicit `prompt`.

The store takes feature definitions at construction and selects their rules by
`descriptor.name`. `getEntry(descriptor, key)`, `setEntry(descriptor, key, state)`,
and `removeEntry(descriptor, key)` no longer take per-call comparison rules.
Definitions and converted descriptors must not be mutated after installation.
Unknown feature names are internal caller errors; §6 must reject unsupported
author queries before reaching the store. The store does not infer grants
between stronger/weaker descriptor variants.

§3.1 leaves permission lifetimes to the feature and host policy. No clock,
expiry timer, heuristic grant, or automatic reset is introduced here. The
store's `removeEntry()` only removes a record; `revoke()` adds §5.4's feature
cleanup. Lifetime policy and expiry remain separate integration work.

**Exit proof:** tests cover all states, missing entries, semantic origin
comparison, opaque identities, feature/aspect isolation, both key-type checks,
compound keys, replacement/removal ordering, independent stores, and retention
through real Window navigation with isolation between browser instances.

## §§3.3–4: feature definitions and defaults

`new PermissionFeature(name, key, options)` gives each feature one ASCII-lowercase name,
descriptor/result type names, default state, descriptor equality, and key rules.
Defaults are `PermissionDescriptor`, `PermissionStatus`, `prompt`, descriptor
name equality. Supply `originPermissionKey` for standard top-level origin keys
compared by same-origin. Custom keys
supply their type check, generation, and comparison together. Descriptor
comparison includes any feature-specific aspects after Web IDL conversion;
conversion itself belongs to §6.

`UserAgent` installs only Storage's `persistent-storage` definition. It uses the
requesting origin instead of the default top-level origin, preserving Storage's
requirement that same-origin settings share a permission state regardless of
their embedder. Storage otherwise defaults the key algorithms; this tension is
recorded as `SPEC_CLASH(storage-permission-origin-key)` in its
[roadmap](../storage/ROADMAP.md#persistence-permission). This does not change
storage partitioning. Synthetic features
in tests do not expose or claim support for those browser APIs. The internal
definition table is separate from the specification's public Permissions Registry.

The permissions task source is wired through the existing environment/event-loop
machinery. Tasks retain their destination Document and are removed on destruction.

The rest of §4 describes contracts whose consumers come later:

- §5.1 applies feature constraints to its fallback state. Feature owners with a
  descriptor partial order must supply implied decisions and keep recorded
  grants/denials consistent; no installed feature currently has ordered aspects.
  Equality of stored records is not a stronger/weaker permission decision.
- §6 must resolve the descriptor/result type names through Web IDL and implement
  the default query algorithm by setting `PermissionStatus.state` to the effective
  permission state. These names currently describe types; they create no objects.
- Extra permission data and its constraints need a feature consumer and host
  intent information; repeated reads must reuse the result until intent changes.
  No current feature requires this data, so it is not implemented yet.
- §5.4 supplies explicit revocation. Permission lifetime expiry still needs its
  policy and per-global task delivery: reset to the default state and queue the
  feature's cleanup for associated globals. No expiry timer is introduced here.

**Exit proof:** defaults and overrides, case-sensitive lookup, duplicate/unknown
feature rejection, aspect and compound-key matching, requesting-origin Storage
scope, task ordering/ownership, and Document-destruction cleanup.

## §5.1: reading permission state

`env.permissions.getCurrentPermissionState(name)` creates the base descriptor and
calls `getPermissionState(descriptor)` on the same owner. Callers select the
relevant/current environment explicitly; the subsystem does not discover an
ambient realm. `BrowletEnvironment` satisfies this view directly.

Lookup denies non-secure contexts first. For a feature marked `policyControlled`,
it then asks `env.isAllowedToUse()`. HTML checks the associated Document when one
exists; globals without a Document allow this check. Features without that policy
skip it.
Key generation receives the top-level origin followed by the requesting origin;
a missing top-level origin is an initialization error, not a fallback to another
origin. An existing store entry returns its state, including an explicit `prompt`.
Otherwise, lookup applies the feature's optional `constrainState()` to its default.

Browlet records host decisions in the store and does not infer intent from
browsing history or other signals. Reads neither prompt nor write decisions.
Constraint processing follows §5.1's order: it handles the fallback after an
absent entry, rather than silently rewriting an explicit stored decision.

`policyControlled` is feature-definition metadata, not a policy evaluator.
HTML's Document has activity checks, but Permissions Policy evaluation for a
fully active Document still throws explicitly. Only `persistent-storage` is
installed; it is not policy-controlled. Future feature definitions must mark
their policy dependency correctly when installed.

Storage now reads and writes this same store. Its host setter still applies
Storage's existing revocation behavior, and its origin-based getter remains
usable without a live environment. Effective permission reads additionally
apply §5.1's eligibility checks; an insecure read returns `denied` without
overwriting a saved grant. Direct store mutations remain low-level bookkeeping,
not an implementation of the general revocation algorithm.

**Exit proof:** defaults, explicit stored states, constraints with descriptor
aspects, secure-context/policy ordering, absent-Document behavior, key-generation
arguments, missing initialization, shared Storage decisions, revocation, and
real Document policy-stub propagation. Browser request/query differences are
documented in the [Storage roadmap](../storage/ROADMAP.md#persistence-permission).

## §5.2: requesting permission

`env.permissions.requestPermission(descriptor)` reads the effective state first and returns
an existing grant or denial without prompting or writing. The named shorthand
is `requestPermissionToUse(name)`. For `prompt`, feature-owned `canRequest()`
may decline new consent without changing stored state; otherwise the browser
asks its host. The answer is returned separately from a queued permissions task
that saves the descriptor, generated key, and decision.

**Integration choice:** the specification waits for user input and returns a
state. The implementation returns `InternalPromise<PermissionDecision>` instead
of blocking the shared Node thread (`SPEC_MISMATCH` in `permissions.ts`). Browser-owned
continuations wait for consent, and the store task belongs to the requesting
global. Destroying its Document discards an already queued update.

`BrowletConfig.permissionPrompt` receives the converted descriptor and serialized
requesting/top-level origins. It returns `true` or `false`, synchronously or through
a Node Promise; without a callback, new requests are denied. Exceptions, rejected
Promises, and non-boolean answers reject the internal operation without recording
a decision. This host callback is not an author-facing Permissions API.

For `persistent-storage`, new requests require matching requesting and top-level
origins. This follows Chromium's new-consent check; an existing decision still
returns at §5.2 step 2. Declining an embedded request does not poison that origin's
next top-level request. `StorageManager.persist()` consumes the returned decision
to protect its bucket; permission requests alone do not change bucket mode.
That method adds no separate WebKit-style cross-origin gate. See the
[browser comparison](../storage/ROADMAP.md#persistence-permission).

**Exit proof:** existing-state short circuits, delayed consent and queued saving,
denials, policy/security checks, descriptor aspects and custom keys, cross-origin
storage followed by a top-level request, host error propagation, real Node callback
adaptation, Document task ownership/destruction, and Storage's shared decisions.

## §5.3: prompting the user to choose

`env.permissions.promptUserToChoose(options, descriptor, allowMultiple, extraInformation)`
accepts a converted descriptor or its name shorthand. Denied effective state
returns without opening a chooser. New-consent restrictions apply when the state
is `prompt`; otherwise the host is asked to select from the offered values.

`BrowletConfig.permissionChooser` receives a snapshot of the options, the
descriptor, `allowMultiple` (default false), caller-supplied prompt details, and
serialized requesting/top-level origins. The host returns original option values
or `denied`, directly or through a Node Promise. An empty selection also means
denied; an absent chooser denies by default. Invalid selections reject the
operation: selected values must be offered, distinct, and limited to one unless
multiple selection was requested. Host errors propagate without saving a denial.

The implementation returns `InternalPromise<T[] | 'denied'>`; even a single
selection is an array (`SPEC_MISMATCH` in `permissions.ts`). It neither grants/revokes
permission nor queues a store update. §5.3 permits asking even when permission is
already granted. Browlet always invokes the host chooser, so it does not introduce
the optional silent-selection cache or its user-intent invalidation machinery.

No installed feature currently needs a chooser. Feature consumers must supply
their option lists and display information; this does not implement media-device
discovery, capture, or any other device API. The separate §4 extra-permission-data
model and its constraints remain a dependency when a feature needs them.

**Exit proof:** denied/security/policy checks, existing-grant prompting, single and
multiple selections, cancellation, empty offers, original object identity, stable
offered sets during asynchronous UI, invalid host selections, unchanged permission
state, and real browser-to-Node callback adaptation.

## §5.4: permission revocation

`PermissionStore.revoke(descriptor, key)` calls the installed feature's `revoke()`
cleanup, then removes the matching decision. The default cleanup does nothing.
It uses the supplied
feature key directly; no live settings object or key regeneration is needed.
Unknown features or invalid key types throw before cleanup. The operation does
not write `denied`: subsequent state reads use the feature's default/constraints.
Cleanup runs even if no matching entry remains, and a thrown cleanup error stops
the operation before removal. `removeEntry()` remains bookkeeping without effects.

Feature hooks receive the descriptor and key explicitly, instead of relying on
the specification's no-argument, implicit-context algorithm (`SPEC_MISMATCH` in
`features.ts`). UserAgent binds Storage's shared definition to its own
`StoragePersistence.revokeProtection()` when constructing the store. Each browser
therefore cleans its own retained storage, including after navigation or while
author storage access is disabled. This changes protection, not stored data.

Two wording conflicts are kept explicit in source:

- `SPEC_CLASH(permissions-default-revocation-recursion)`: §4 defaults the feature
  hook to §5.4, which calls that same hook. Browlet instead performs no extra
  cleanup for an unspecified hook, then removes the entry once. Chromium's
  [`PermissionContextBase::ResetPermission()`](https://github.com/chromium/chromium/blob/main/components/permissions/permission_context_base.cc)
  likewise clears the configured site setting; it is not a recursive reset.
- `SPEC_CLASH(storage-permission-revocation-order)`: §5.4 runs cleanup while the
  old grant remains stored, but Storage's first cleanup step returns if permission
  is granted. Browlet honors the known withdrawal when removing bucket protection,
  then removes the decision in §5.4 order. This is an explicit integration choice,
  not a claim of identical browser behavior. The ordinary Storage host setter
  invokes the same protection cleanup only for a non-granted new decision.

**Exit proof:** cleanup/removal ordering, defaults, descriptor aspects, custom and
origin keys, absent/repeated decisions, error propagation, low-level removal,
browser isolation, navigation, disabled storage, preserved local/session data,
no-Window/no-allocation behavior, and author-visible `storage.persisted()` changes.

## §6.1: Navigator permissions

Window's `Navigator.permissions` returns the `PermissionsImpl` retained by the
Navigator's relevant environment. Binding projects that object through the
ordinary `Permissions` interface; `[SameObject]` does not need a custom hook.
Separate Navigators get separate objects, including after navigation. The
getter and interface are exposed in insecure contexts too; permission state
lookup still applies its secure-context rule.

Permissions owns both Navigator partial declarations. HTML assembles the Window
contribution and supplies the getter on its primary `NavigatorImpl`. The
`workerNavigatorPermissionsIDL` contribution is exported but not assembled until
HTML §10 supplies WorkerNavigator, its object ownership, and worker startup.

§6.2 adds querying to this identity; §6.3 supplies notification behavior.

**Exit proof:** secure/insecure Window exposure, stable identity, readonly and
receiver checks, illegal construction, first-read projection through a borrowed
getter, separate realms, decision changes, and replacement after navigation.

## §6.2: querying permissions

`PermissionsImpl.query()` checks the current Document's activity before reading
descriptor members, converts the original object to `PermissionDescriptor`, rejects
unsupported names, then converts that same object to the feature's descriptor type.
Both conversions use Web IDL, including the specified second read of `name` and
unchanged propagation of getter exceptions. Binding rejects invalid arguments and
receivers through promises rather than synchronous author exceptions.

One task on the receiver global's permissions task source creates a fresh status,
runs the feature's optional `query()` hook, and settles the Promise. The hook
defaults to the existing permission-state lookup, and rejection receives the same
HTML checkpoint as success. Querying does
not prompt, record a decision, or change bucket protection. Only `persistent-storage` is installed;
names for APIs Browlet has not installed reject with TypeError.

`SPEC_CLASH(permissions-query-parallel-allocation)`: [Permissions §6.2.1](https://w3c.github.io/permissions/#dom-permissions-query)
explicitly creates and populates the initial `PermissionStatus` after continuing
in parallel. [HTML §8.1.7.5](https://html.spec.whatwg.org/multipage/webappapis.html#event-loop-for-spec-authors)
forbids creating or manipulating realm-associated objects in parallel. Browlet
follows HTML's task boundary and the browsers' confinement of object work to its
owning context, instead of Permissions' literal parallel allocation. Descriptor
conversion and Promise creation remain synchronous; status creation, query, and
settlement now share the specified permissions task. The earlier implementation
followed Permissions' ordering through a cooperative Node turn. This change fixes
that placement without claiming an observed concurrent-JavaScript data race.

The follow-up browser-source investigation confirms that implementations do not
literally allocate the status in background work:

| Engine | Initial query boundary |
| --- | --- |
| [Chromium](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/modules/permissions/permissions.cc) | `HasPermission()` returns permission data through the context's `kPermission` task runner. `TaskComplete()` then creates the status through `PermissionStatus::Take()` and resolves the Promise. |
| [WebKit](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/permissions/Permissions.cpp) | Queries the permission controller, then uses `ensureOnContextThread()` before creating `PermissionStatus` and resolving. A denied Permissions Policy check also creates its result on the owning context. |
| [Firefox](https://github.com/mozilla-firefox/firefox/blob/main/dom/permission/Permissions.cpp) | Creates the internal status synchronously before asynchronous initialization. [Initialization](https://github.com/mozilla-firefox/firefox/blob/main/dom/permission/PermissionStatus.cpp) applies returned state on the current serial event target, and resolution returns to that target too. |

Their allocation points differ, but realm-associated work stays on the owning
context. Browlet's `createPermissionStatus()` calls Binding's
`createPlatformRecord()`, which eagerly allocates the Platform object as well as
its Implementation; it is not merely collecting realm-neutral result data.

The installed `persistent-storage` query uses an in-memory store and synchronous
environment checks, so it needs no separate background turn. This preserves the
existing feature-query contract and requires no engine changes. A future external
lookup must return data before the permissions task, rather than manipulate the
status off the owning loop. The query test verifies allocation and population
inside that task; lifecycle cases verify deferral while inactive, resumption on
reactivation, and cancellation before allocation when the Document is destroyed.
The existing borrowed-method test preserves the distinct result realm and task
destination. Subsequent `PermissionStatus` update scheduling is a separate path;
this change is limited to the initial query.

The method's environment supplies current settings, conversion, the promise, and
result allocation. The receiver supplies the relevant global for delivery. This
distinction follows §6.2.1's current-settings check and explicit task target.
Chromium's `Permissions::query()` likewise uses its invocation `ScriptState` for
Document checks and the promise resolver
([source](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/modules/permissions/permissions.cc)).

**PermissionStatus dependency:** `browlet/integration/permissions` supplies an
actual `EventTargetImpl` subclass with initialized `name`, stored `state`, and the
converted `query` descriptor. The portable Permissions algorithms use its small
`PermissionStatusData` state contract; Browlet's allocation factory retains the
concrete implementation. Binding performs descriptor conversion and creates the
registered result interface. Future feature descriptor dictionaries and result
subclasses must be included in the binding assembly; missing result types fail
explicitly rather than silently falling back to the base class.

The creation/name/state prerequisites from §§6.3.1–3 are included here; the rest
of the lifecycle is described below. WorkerNavigator and worker globals still
need HTML integration. Permission expiry and Permissions Policy remain the
previously recorded dependencies.

**Exit proof:** all initial states, security restrictions, unchanged store and no
prompt, real EventTarget behavior, fresh/readonly/branded results, promise rejection
and original getter errors, two-stage conversion, inactive-document ordering,
task-owned allocation and Document lifetime, borrowed-method settings and result ownership, and a
feature query override.

## §6.3: PermissionStatus updates and lifetime

`onchange` uses HTML's ordinary event-handler binding and DOM's listener list.
Initial queries and subsequent updates share `PermissionsImpl.runPermissionQuery()`, including
feature overrides. Store writes/removals invalidate live results for that feature;
each result rechecks its own origin, descriptor, and constraints asynchronously.
Only a changed effective state queues a trusted `change` event on the result's
global's permissions task source. State is updated before event delivery, even
without listeners. Redundant writes and unrelated permission keys produce no event.

Inactive or missing Window Documents suppress updates. The existing Document
activity notification rechecks its results on reactivation. Queued change events
use ordinary Document task ownership, so destruction discards them. Chromium
likewise guards event delivery by Document activity and resumes observation when
its execution context runs again
([status](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/modules/permissions/permission_status.cc),
[listener](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/modules/permissions/permission_status_listener.cc)).

UserAgent discovers statuses through `WeakOrderedSet`; creating queries alone
does not keep results or old globals alive. Each global strongly retains results
with a `change` listener. The existing EventTarget listener-change hook covers
`onchange`, explicit listeners, `once`, abort signals, and removal. Unobserved
results can be collected; collection timing is not an API contract or test deadline.

**Remaining dependencies:** feature APIs and Permissions Policy must call
`UserAgent.notifyPermissionStateChanged(name)` when non-store inputs change.
The hook is present and tested; those missing owners are not simulated. Worker
startup/termination and permission expiry remain unimplemented. Features with
additional query-result fields need their own update detection beyond the base
PermissionStatus state enum.

**Exit proof:** author-code trusted events and handler identity/order, updates
without listeners, asynchronous state/event ordering, redundant and ineffective
decisions, revocation, inactive/reactivated/destroyed Documents, borrowed-query
result ownership, feature query overrides, and listener-driven strong retention.

## §7: conformance

[§7](https://w3c.github.io/permissions/#conformance) defines normative wording
and distinguishes user-agent conformance from requirements on specifications
that define powerful features. Browlet implements the user-agent side; feature
definitions supply the §4 contracts. This section adds no runtime algorithm.
The implementation coverage above remains subject to the dependencies below.

## Appendix A: relationship to Permissions Policy

[Appendix A](https://w3c.github.io/permissions/#relationship-to-the-permissions-policy-specification)
is explanatory. Policy can disable access, but allowing a feature does not grant
user permission. `getPermissionState()` already checks applicable Document policy
before consulting stored consent, then uses the feature's state rules.

**Dependency:** Permissions Policy evaluation remains with
[browsing policy](../browlet/browsing/policy/ROADMAP.md). Its missing evaluator
fails explicitly; the permission store does not substitute for it. Once
implemented, policy changes must also notify existing PermissionStatus results.

## Appendix B: permission automation core

`UserAgent.setPermission()` accepts a converted descriptor, state, resolved
feature key, and candidate environments. It forwards to
[`PermissionStore.setPermission()`](store.ts), which filters environments by
owner and the feature's key rules, queues one permissions task per match, and
returns a host-owned InternalPromise after those tasks run. Without a match, it
records the decision immediately for future settings. Selection finishes before
any tasks are queued or decisions written. A missing feature, invalid key, or
unfinished top-level origin rejects the operation. This is an internal entry
point, not a method on the author-facing Permissions object.

**Review choices:** the explicit key, candidate environments, selected owner, and promise
replace Appendix B's optional arguments, ambient enumeration, and blocking wait
(`SPEC_MISMATCH`). `SPEC_GAP(permissions-automation-state-application)` records the
draft's unspecified "interpret state" mechanism: the first target task updates
the shared store once, running feature revocation for a non-granted decision.
The other target tasks complete the wait. An explicit `prompt` remains stored,
including when a feature has a different default. Ordinary state lookup still
enforces security and policy; PermissionStatus refresh and events stay asynchronous.
Completion does not wait for change-event delivery.

`SPEC_CLASH(permissions-automation-no-target)` follows browser behavior:
[Appendix B](https://w3c.github.io/permissions/#dfn-set-a-permission) only applies
the state inside tasks for matching settings, so an empty match set does nothing.
Firefox's
[automation setter](https://github.com/mozilla/gecko-dev/blob/master/remote/shared/Permissions.sys.mjs)
updates its origin-scoped permission service without requiring a matching page.
Chromium's
[permission controller](https://github.com/chromium/chromium/blob/main/content/browser/permissions/permission_controller_impl.cc)
likewise stores an override in `SetPermissionOverride()` before notifying existing
subscriptions, even when there are none. Browlet records the decision without a
matching environment, allowing permission setup before navigation. It uses the
same store and feature cleanup as the live-target path; cleanup failures reject
the operation. Matching targets still apply the decision in their first task and
complete only after every target task runs.

**Dependencies:** the caller must supply the selected owner's complete live
settings list; this slice introduces no global registry. WebDriver/BiDi still own
session/user-context lookup, omitted-key generation, origin parsing,
PermissionSetParameters and feature-descriptor conversion, command-specific
state validation, wire errors, and HTTP/WebSocket dispatch. An inactive target's
task waits for activation; if destruction discards it, command cancellation must
end the wait. That driver lifecycle and worker enumeration remain unimplemented.

**Exit proof:** all states, compound keys and descriptor aspects, user-agent and
origin isolation, decisions retained with empty or unrelated settings and queried
after navigation, completion after every target, explicit preflight/feature
errors, live author-code events, secure-context restrictions,
and Storage cleanup without data loss.

## Remaining integration

- Lifetime expiry and §4's extra permission data remain. Host consent UI,
  cancellation of a still-open prompt or chooser, and concurrent-decision
  coordination are host dependencies. In particular, §5.4 does not cancel a
  pending host answer or an already queued §5.2 store write; those must be
  coordinated with newer user intent when the prompt lifecycle is integrated.
  Secure-context and queued-task Document lifecycle checks exist;
  [Permissions Policy](../browlet/browsing/policy/permissions-policy/ROADMAP.md) evaluation is still
  a dependency for policy-controlled features.
- WorkerNavigator integration, worker creation/termination, and non-store state
  invalidations from Permissions Policy and future feature APIs remain dependencies.

Storage's former decision map has been removed. Its feature definition and host
consent API use the single user-agent permission store, preserving origin-wide
scope and revocation without a live Document.
