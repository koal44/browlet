# Navigator roadmap

HTML §8.10 defines `Navigator` as a per-global facade assembled from multiple
capability mixins. It should not become a miscellaneous owner for the network,
cookies, permissions, or host platform; those subsystems supply its answers.

The implemented surface supplies Window's stable Navigator identity, its
`clientInformation` alias, a forwarding `storage` getter, and its retained
`permissions` object. Pointer Events §6 also contributes `maxTouchPoints`, whose
getter selects an environment-scoped BiDi override before querying its UserAgent
for device capacity. The hardware query explicitly throws until the native input
host exists; the BiDi selector returns null while there are no active sessions.
The [Pointer Events audit](../interaction/pointer/ROADMAP.md#pointer-events-6-navigator-touch-capacity)
records the required host result and pending automation algorithm. NavigatorID now
supplies client identification on Window and WorkerNavigator as described below.
NavigatorLanguage supplies stable language lists and queued change notifications;
NavigatorOnLine reuses Fetch's connectivity state and queues transition events;
the other HTML capability families remain pending.

| Planned source | Contract | Specification |
| --- | --- | --- |
| `navigator.ts` | Stable Window `navigator` identity and common Navigator object state | HTML §8.10.1 |
| `identification.ts` | Implemented `NavigatorIDMixin` and its IDL contribution, using Fetch's user-agent selector | HTML §8.10.1.1 |
| `language.ts` | Implemented `NavigatorLanguageMixin`, stable preference snapshots, and per-global change tasks | HTML §8.10.1.2 |
| `online.ts` | Implemented `NavigatorOnLineMixin`, live Fetch state, and per-global connectivity events | HTML §8.10.1.3 |
| `protocol-handler.ts` | Custom protocol-handler validation and embedder registration capability | HTML §8.10.1.4 |
| `cookies.ts` | `NavigatorCookies.cookieEnabled` over actual cookie policy/state | HTML §8.10.1.5 |
| `plugins.ts` | PDF-viewer compatibility objects and legacy plugin/MIME-type collections | HTML §8.10.1.6 |
| `hardware.ts` | `NavigatorConcurrentHardware`, host logical-processor capability, implementation limits, and fingerprinting reduction | HTML §10.2.7 |
| `worker-navigator.ts` | `WorkerNavigator` assembled from the ID, language, online, and concurrent-hardware mixins without Window-only state | HTML §§10.2.1.1 and 10.3.2 |
| `web-idl.ts` | Navigator, mixins, legacy collections, and Window contributions | HTML §8.10 |

`WorkerNavigator` reuses selected mixin behavior without sharing a Window
Navigator object. Worker-global creation owns its lazy/stable instance;
`navigator/` owns the common capability answers. Additional specifications
contribute their own members through Browlet's ordinary Web IDL assembly.

Storage Standard §8 contributes `NavigatorStorage` and `StorageManager.persisted()`;
the [Storage roadmap](../../storage/ROADMAP.md#storagemanager-api) tracks the
remaining methods and worker integration. Permissions §6.1 contributes the
`permissions` partial; the environment owns `PermissionsImpl`, Navigator returns
it, and Binding supplies its platform identity. Querying, status updates, and
remaining dependencies are covered in the
[Permissions roadmap](../../permissions/ROADMAP.md#61-navigator-permissions).
WorkerNavigator must expose its environment's object and assemble the exported
Worker partial when worker settings are implemented. Its current
implementation supports WorkerGlobalScope's stable `navigator` attribute and
NavigatorID, NavigatorLanguage, and NavigatorOnLine; the other HTML mixins and Permissions/Storage members are still
explicit dependencies.
Storage's `persist()` uses the same permission owner.

For `NavigatorID.userAgent`, call Fetch's `getEnvironmentDefaultUserAgent()`
with this Navigator's relevant settings object, as HTML prescribes. Browlet's
UserAgent already owns the configured default; the settings supply the scoped
BiDi query. Reporting and request-header insertion use the same selector.
Do not introduce a second identification value on Navigator or its environment.

Blink likewise keeps a base Navigator/WorkerNavigator in core while feature
modules contribute separate IDL mixins. Browlet should preserve that extension
shape instead of accumulating every future API in `navigator.ts`.

## Client identification

[HTML §8.10.1.1](https://html.spec.whatwg.org/multipage/system-state.html#client-identification)
was audited against the clean local HTML revision
`5fcc2318395821db61e353705e6368ad9a000af5`, refreshed on 2026-11-06.
The preceding Navigator object section already has its per-Window identity,
relevant realm, and replaceable `clientInformation` alias.

`NavigatorIDMixin` owns the common getter behavior. Navigator and WorkerNavigator
construct it with their own environment and explicitly forward their members;
Binding supplies the two independent platform interfaces and receiver checks.
The mixin has no author-visible constructor. `productSub`, `vendor`, and `vendorSub`
are exposed only on Window's Navigator.

Eric approved HTML's **Chrome** navigator compatibility mode: the fixed strings
are `Mozilla`, `Netscape`, `Gecko`, `20030107`, `Google Inc.`, and the empty vendor
suffix. This is one of HTML's specified profiles, not an assertion that Browlet
is Google Chrome. The existing configured User-Agent still identifies Browlet.
Gecko-only `oscpu` and `taintEnabled()` are absent; there is no mode-switching API.

`userAgent` and `appVersion` both select Fetch's environment default User-Agent,
including its existing per-environment BiDi override. No value is copied into
Navigator, and borrowed getters retain the receiver's settings. Header values
already use isomorphic strings. `appVersion` returns the portion after `Mozilla/`
only when the full value starts with `Mozilla/5.0 (`; otherwise it returns empty.

`SPEC_CLASH(navigator-appversion-prefix)`: Chromium and WebKit remove everything
through the first slash even for `Custom/1.0`, `Mozilla/4.0 (test)`, or
`Mozilla/5.0 plain`. Firefox's Window retains its normal appVersion under the
probe's User-Agent override. Eric approved the written HTML prefix rule.
Blink's `NavigatorID::appVersion()` in `core/frame/navigator_id.cc` confirms its
first-slash implementation. The
[browser probe](../../../node-compat/experimental/browser-probes/html/navigator-identification.mjs)
and [observations](../../../node-compat/experimental/browser-probes/html/NAVIGATOR-IDENTIFICATION-RESULTS.json)
cover Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2, both Window and routed
dedicated workers. All three omit Window-only identification fields from workers.
Firefox's worker did not inherit the automation override; the probe is not evidence
of a shared override mechanism across browsers. Empty automation input reverted
to each browser's default, so it does not test an explicitly empty BiDi value.

Eric also approved `UserAgent.navigatorPlatform`, defaulting to `Win32` and read
by both includers. HTML permits a common platform value for compatibility/privacy.
It deliberately does not detect the physical OS or infer one from User-Agent text.
`BrowletConfig.platform` now supplies that UserAgent property before the initial
Window is created. Omission retains `Win32`; any explicit string is preserved,
including the empty string. This adds no OS adapter.

The existing `webDriverBiDiEmulatedUserAgent()` selector still returns null until
session/emulation routing exists. Worker settings composed in this isolate use
the same UserAgent and their own environment. Cross-isolate service transport is
still blocked by `WorkerThreadRuntime` startup's named throwing dependency; the
worker owner must carry identification policy and scoped emulation when connecting
that transport. This slice does not manufacture a worker-local substitute owner.
Language preferences and online transitions are covered below. Protocol handlers,
cookies, plugins, and hardware concurrency remain separate Navigator families.

Focused tests cover all nine Window fields and six worker fields, descriptors,
receiver errors, exact-prefix and byte-string cases, current configuration,
environment-specific overrides, navigation retention, and dedicated/shared worker
composition. Generated type contracts exclude Window-only fields from workers.
Those contracts initially failed because unrestricted type generation admitted
every mixin member without checking its including interface's global exposure.
The focused generator regression reproduced that error for member and partial
exposure. Generation now requires a possible shared global, retaining declared
Worker/DedicatedWorker aliases and conditional secure-context members.

All 20 Navigator cases pass on Node 24.19.0, 26.8.1, and custom 27.0.0-pre in
stock and compat modes. The generator and adjacent UserAgent/worker tests bring
the Node 26.8.1 compat focused run to 98 passing cases. Typechecking, focused lint,
and import-boundary checks pass. No expected failures or skips were added.

## Language preferences

[HTML §8.10.1.2](https://html.spec.whatwg.org/multipage/system-state.html#language-preferences)
was audited at the same local HTML revision, refreshed on 2026-11-06.
`NavigatorLanguageMixin` owns each Navigator's published list. Both Window and
WorkerNavigator explicitly forward `language`, `languages`, and the internal
`queueLanguageChange()` entry. The existing languagechange handler declarations
already cover both globals. Binding creates the frozen array in the receiver's
realm and preserves it while the implementation list is unchanged.

Eric approved `UserAgent.preferredLanguages`, defaulting to the plausible list
`["en-US"]`, and `setPreferredLanguages(tags, navigators)` with an explicit
recipient iterable. Tags are a nonempty list of valid BCP 47 strings supplied by
the host/configuration owner. This layer copies them without canonicalization,
deduplication, added fallback tags, or OS locale detection. It does not substitute
`Intl` locale validation for full BCP 47 support. The producer must supply all
affected Window/worker navigators, including workers outside browsing-context
groups; no global reverse registry was added.

`BrowletConfig.languages` now supplies the initial list before any globals exist,
so startup configuration queues no languagechange notification. The host API
accepts readonly arrays, rejects an empty/non-array input and entries outside
the basic hyphen-separated ASCII tag shape, and copies the list through the
existing setter. The shape check excludes wildcards and HTTP weights/separators
but is not a full BCP 47 parser or registry validator; callers still supply valid
tags. Private-use and grandfathered tags remain accepted without `Intl`
canonicalization. Both language and platform settings survive navigation and
remain independent between Browlet instances.

The setter also updates Fetch's existing `defaultAcceptLanguage` to the same
comma-separated list; its initial value is now `en-US`. Explicit request headers
and per-environment BiDi overrides retain their existing precedence. The existing
raw-header setting still accepts null to suppress that default. HTTP requests
use the new default immediately; each existing Navigator waits for its own task.

Each update captures its selected tags and queues the DOM-manipulation task on
the receiver's environment. The task publishes the list before firing a trusted,
non-bubbling, non-cancelable, non-composed `languagechange` at its original global.
Equal lists preserve identity and do not fire; order changes count as changes.
Successive captured updates run in task order, including changes requested by a
listener. Window tasks retain the original Document's activity/discard behavior;
worker tasks use their own event loop. There is no additional lifetime registry.

Initial BiDi selection is lazy because a Navigator is constructed before its
Window's Document is attached. `queueLanguageChange(tags, emulationUpdated)` must
be called **before** changing the producer's preference/emulation source, so it
can retain the previous value even when no getter has been used. The UserAgent
setter enforces that order. Future BiDi updates must do the same and set
`emulationUpdated` when adding, changing, or removing an override; this also
replaces the array when the effective tags happen to remain equal. Scoped
overrides continue to win over ordinary preference updates. The existing BiDi
selector remains the explicit no-session stub, with its update obligation in
source. OS preference watching, complete recipient discovery, and worker
cross-isolate service transport are still producer dependencies; this slice does
not claim automatic native or remote delivery.

`SPEC_CLASH(navigator-languages-identity)`: Eric approved HTML's stable identity
rule. The [probe](../../../node-compat/experimental/browser-probes/html/navigator-language.mjs)
and [observations](../../../node-compat/experimental/browser-probes/html/NAVIGATOR-LANGUAGE-RESULTS.json)
show Firefox 157.0 preserving identity in Window and workers; Chromium
156.0.8078.4 preserves it normally but returns fresh arrays on the Window under
Playwright's locale override. WebKit 27.2 returns fresh arrays in both globals.
All three return frozen arrays in the receiver's realm, including borrowed
Window getters. These locale probes do not establish OS-change or BiDi timing.
Blink's `core/frame/navigator_language.cc` marks overridden languages dirty on
every access; Gecko's `dom/base/Navigator.cpp` delegates caching and timed
invalidation to Window, and `dom/workers/WorkerPrivate.cpp` updates worker
languages before firing its event. WebKit's `page/NavigatorBase.cpp` supplies
only the primary language as its privacy policy. Browlet retains the approved
configured list rather than adopting that list-reduction policy.

The 19 focused tests cover initial/default/emulated values, frozen identity and
receiver realms, queued visibility, ordering, reentrancy, Document activity and
discard, dedicated/shared workers, and Fetch header precedence. They pass across
Node 24.19.0, 26.8.1, and custom 27 in stock/compat modes. The adjacent Navigator,
Fetch, and worker run has 107 passing tests. No expected failures or skips were
added. Browser-only evidence remains in Experimental.

## Browser state

[HTML §8.10.1.3](https://html.spec.whatwg.org/multipage/system-state.html#navigator.online)
was audited at the same local HTML revision, refreshed on 2026-11-06.
`NavigatorOnLineMixin` returns the inverse of Fetch's existing
[`isOffline(env)`](https://fetch.spec.whatwg.org/#is-offline), using the receiver's
settings. UserAgent's offline assumption takes precedence over environment-scoped
BiDi state. The getter reads current state immediately; true means only that the
browser might be online. There is no second connectivity value on Navigator.

Eric approved `UserAgent.setOffline(offline, navigators)` with explicit affected
Window/worker recipients. It captures each distinct recipient's previous effective
value before updating `assumeNoInternetConnectivity`, then asks that Navigator to
queue a notification only if its effective state changed. An emulation override
can keep an environment offline through a browser-wide update. The temporary Map
retains previous values only during the call; it is not a recipient registry.

`queueOnlineStateChange(wasOnline)` captures the transition's event type and queues
the original global's networking task. Events are trusted, non-bubbling,
non-cancelable, and non-composed. Successive transitions keep their order, even
when the getter changes again before either event runs. Listener-triggered changes
also queue another task. Existing Window/worker and body handler declarations are
reused. Window tasks retain their Document's activity/discard behavior; worker
tasks use their own loop and are discarded when that worker closes.

`SPEC_CLASH(navigator-online-worker-notifications)`: In the
[browser probe](../../../node-compat/experimental/browser-probes/html/navigator-online.mjs)
and [observations](../../../node-compat/experimental/browser-probes/html/NAVIGATOR-ONLINE-RESULTS.json),
Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2 all update the Window getter
and fire the two global events with the specified flags, without duplicate events
for unchanged state. WebKit also updates/notifies the dedicated worker; Chromium
changes its worker getter without events; Firefox leaves the worker online.
Eric approved HTML's worker notification requirement. These are Playwright
network-emulation observations, not physical-network or WebDriver BiDi evidence.

Host connectivity monitoring, complete recipient discovery, BiDi change routing,
and cross-isolate transport remain explicit producer dependencies. The existing
default assumes connectivity; it does not detect the OS network. Future BiDi
updates must capture each affected Navigator's old getter value, apply the scoped
change, and call `queueOnlineStateChange()` with that old value. The producer must
supply workers outside browsing-context groups as well as Windows; no automatic
discovery or worker-local replacement UserAgent was introduced.

The 19 focused tests cover descriptors/receiver realms, shared Fetch state,
immediate values and queued events, effective-state filtering, repeated recipients,
ordering/reentrancy, body forwarding, Document activity/discard, and dedicated/shared
worker ownership and closure. They pass on Node 24.19.0, 26.8.1, and custom 27 in
stock/compat modes. The adjacent Navigator/Fetch run has 62 passing tests; typecheck
and focused lint pass. No expected failures or skips were added.

The next Navigator slice is §8.10.1.4, custom scheme handlers. It is independent
of the unfinished OS connectivity and cross-isolate transport boundaries.

## Removal condition

Burn this file once each Navigator family has implemented source or an
explicit host capability and Window/worker identity is tested.
