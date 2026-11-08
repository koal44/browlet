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
NavigatorContentUtils supplies secure-Window methods and shared parameter validation.
The UserAgent registry retains registration decisions, removes exact pairs, and
prepares invocation URLs; WebDriver supplies the registration-mode command body.
Consent, automation sessions, persistence, handler selection, and navigation retain
explicit owner dependencies. NavigatorCookies reports the existing UserAgent cookie
policy on Window. NavigatorPlugins supplies PDF compatibility reporting and the
legacy plugin/MIME collections, using navigation's existing support decision.

| Source | Contract | Specification |
| --- | --- | --- |
| `navigator.ts` | Stable Window `navigator` identity and common Navigator object state | HTML §8.10.1 |
| `identification.ts` | Implemented `NavigatorIDMixin` and its IDL contribution, using Fetch's user-agent selector | HTML §8.10.1.1 |
| `language.ts` | Implemented `NavigatorLanguageMixin`, stable preference snapshots, and per-global change tasks | HTML §8.10.1.2 |
| `online.ts` | Implemented `NavigatorOnLineMixin`, live Fetch state, and per-global connectivity events | HTML §8.10.1.3 |
| `protocol-handler.ts` | Implemented secure-Window operations, shared normalization, and parallel registration/removal entries | HTML §8.10.1.4 |
| `protocol-handler-registry.ts` | Implemented exact-pair decisions and invocation URL preparation; consent, persistence, selection, and navigation dependencies remain | HTML §8.10.1.4 |
| `cookies.ts` | Implemented `NavigatorCookiesMixin.cookieEnabled` over the UserAgent policy shared by Fetch and Document cookies | HTML §8.10.1.5 |
| `plugins.ts` | Implemented `NavigatorPluginsMixin`, PluginArray, MimeTypeArray, Plugin, and MimeType; actual PDF viewing remains with navigation/rendering | HTML §8.10.1.6 |
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

## Custom scheme handlers

[HTML §8.10.1.4](https://html.spec.whatwg.org/multipage/system-state.html#custom-handlers)
was audited against the same local HTML revision, refreshed on 2026-11-06.
The first slice exposes `registerProtocolHandler()` and
`unregisterProtocolHandler()` through `NavigatorContentUtilsMixin` on secure
Window Navigators. Workers do not include it. Binding owns receiver checks,
required arguments, `DOMString` scheme conversion, and `USVString` URL conversion.

Both methods run the same normalization synchronously: ASCII-lowercase the
scheme; require HTML's exact safelist or `web+` followed by ASCII letters; require
the original lowercase `%s` placeholder; encoding-parse against the receiver's
current API base URL and Document encoding; and require an HTTP(S) URL with the
receiver's exact origin. Parsed URL records preserve credentials, fragments,
and multiple placeholders. The additional post-parse placeholder check below
prevents accepting a template whose only substitution point was discarded.

Eric approved retaining the normalized scheme, parsed URL, and originating
Document before using the existing environment `runInParallel()` entry. The
parallel steps call `UserAgent.registerProtocolHandler()` or
`unregisterProtocolHandler()`. A valid author call returns undefined after
queuing those steps; it does not wait for consent. The validation tests capture
that queue, while the registration tests below exercise the real owner entries.

Approved conflicts:

- `SPEC_CLASH(protocol-handler-exposure)`: HTML and Chromium expose both methods;
  Firefox exposes only registration; WebKit exposes neither. Follow HTML.
- `SPEC_CLASH(protocol-handler-validation-order)`: HTML and Chromium check the
  scheme before the URL. Gecko's `Navigator::CheckProtocolHandlerAllowed()`
  checks the URL first, producing `SyntaxError` for an invalid scheme combined
  with a missing placeholder. Follow the written order for both methods.
- `SPEC_CLASH(protocol-handler-discarded-placeholder)`: HTML checks `%s` in the
  original input only. With `/%s/../handler`, parsing removes the token. Firefox
  rejects this with `SyntaxError`; Chromium returned undefined and its renderer
  then crashed in the probe sequence. Eric approved rejecting the normalized
  template when it contains no placeholder. A later surviving `%s` remains valid.
- `SPEC_CLASH(protocol-handler-normalized-url)`: normalization returns a URL
  record, while the callers call their result `normalizedURLString`. The approved
  owner contract retains the record. Invocation must serialize it when creating
  the substituted navigation destination.

The [probe](../../../node-compat/experimental/browser-probes/html/protocol-handlers.mjs),
[results](../../../node-compat/experimental/browser-probes/html/PROTOCOL-HANDLERS-RESULTS.json),
and [notes](../../../node-compat/experimental/browser-probes/html/PROTOCOL-HANDLERS-NOTES.md)
record Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. Chromium's result is
partial because its renderer crashed; the probe exits unsuccessfully and retains
the exact in-progress call. This does not establish registration persistence,
consent UI, or handler invocation. Blink's
`modules/navigatorcontentutils/navigator_content_utils.cc` corroborates shared
scheme-first validation for both methods; Gecko's `dom/base/Navigator.cpp` and
`dom/webidl/Navigator.webidl` corroborate its different ordering and absent removal.

### Registration decisions and Document automation

Eric approved a lazy `UserAgent.protocolHandlers` registry. It retains exact
normalized scheme/serialized-template pairs for the UserAgent's lifetime, with
`pending`, `accepted`, or `declined` state. An accepted pair is a candidate; this
does not select a default or register an OS handler. Completed decisions retain
only string keys and state, without retaining their originating Documents,
realms, or completion promises. `register()` exposes an internal browser-owned
completion promise for consent; the existing UserAgent/Navigator entry remains
void and reports implementation failures through the host promise machinery.

Consent comes from the named throwing
`UserAgent.requestProtocolHandlerConsent(scheme, url, document)` dependency,
returning a `HostPromise` boolean. The registry records its result. Synchronous
and asynchronous host failures remove only the corresponding pending entry,
remain observable, and permit a later retry. They are not stored as rejections
by the user. Documents each start with `protocolHandlerAutomationMode = 'none'`.
The registration steps sample that mode when their parallel work runs. A
non-default mode first requires `UserAgent.verifyProtocolHandlerAutomation()`;
`autoAccept`/`autoReject` then bypass consent for a new request. Existing pending
or remembered decisions remain until explicit removal. A mode field does not
establish an active WebDriver session; verification still throws by default.

Approved implementation policies:

- `SPEC_GAP(protocol-handler-pending-requests)`: HTML leaves overlapping requests
  and removal during consent unspecified. Identical pending requests share their
  completion; completed decisions suppress another prompt. Removal invalidates
  the entry, and a late result cannot recreate it or alter a newer request for
  the same pair. The consent host still owns closing its UI; invalidation does
  not pretend to cancel an OS prompt.
- `SPEC_GAP(protocol-handler-forget-decision)`: HTML does not say whether
  unregister also forgets a declined request. Eric approved clearing that exact
  pair, matching Chromium's `RemoveHandler()` handling of ignored registrations.
  Other templates and schemes remain independent.

Source evidence is Chromium's
[`ProtocolHandlerRegistry`](https://github.com/chromium/chromium/blob/67269c72fca56f482a2f3e07bb58e2def7b8daec/components/custom_handlers/protocol_handler_registry.cc):
`IsNoOpRegisterHandlerRequest()` suppresses known/ignored handlers,
`OnIgnoreRegisterProtocolHandler()` remembers refusal, and `RemoveHandler()` also
removes ignored handlers. Chromium additionally replaces some same-origin
handlers and selects defaults. Browlet retains distinct exact pairs and leaves
default selection to the explicit later dependency. This evidence comes from
source inspection, not a new browser consent-UI probe.

### Invocation URL preparation

Eric approved `ProtocolHandlerRegistry.getInvocationURL(scheme, handlerURL,
inputURL)`, extracting invocation steps 1–8 and returning a parsed URL record.
The caller must already have selected an accepted exact pair. The method checks
that precondition and the specified matching input scheme; pending, declined,
unknown, and removed pairs cannot prepare a destination. These internal invariant
failures use `InternalError`, not new exceptions on Navigator's author-facing API.

The method copies the input, clears its username/password using URL's existing
setters, serializes it, applies URL's UTF-8 component encoder, replaces only the
first lowercase `%s` in the serialized template, then parses the result. It uses
the existing URL-owner algorithms; only the encoder's public barrel export is new.
Every call returns a new record, preserving both the input and template. Handler
template credentials and remaining placeholders are unaffected. Result parsing
uses the ordinary URL parser, including its HTTP query escaping rules.

Approved conflicts:

- `SPEC_CLASH(protocol-handler-input-copy)`: HTML sets credentials on `inputURL`
  directly. Chromium's `ProtocolHandler::TranslateUrl()` instead uses a cleaned
  copy when credentials are present. Eric approved copying, so preparation
  cannot mutate URL state retained by the navigation caller.
- `SPEC_CLASH(protocol-handler-invocation-example)`: the written algorithm
  component-encodes the input serialization; the soup example leaves delimiters
  and existing percent escapes less escaped. Follow the algorithm. For
  `web+soup:chicken-kïwi`, the inserted component is
  `web%2Bsoup%3Achicken-k%25C3%25AFwi`, not the example's raw scheme/colon and
  singly escaped text.

Source evidence:

- [Chromium's translator](https://github.com/chromium/chromium/blob/1459b6ef1da32f1553e42659a74fee7f36294c8d/components/custom_handlers/protocol_handler.cc)
  strips credentials from a copy and replaces the first token with
  `EscapeQueryParamValue(..., false)`.
- [Chromium's encoder](https://github.com/chromium/chromium/blob/4d9222c52238af68b8465f0ad2ce4c61b4f86543/base/strings/escape.cc)
  retains the same ASCII characters as URL's component set and escapes percent
  signs; it does not substitute plus signs for spaces in this call.
- [Gecko's handler](https://github.com/mozilla-firefox/firefox/blob/c28c54eb0b403ae0e0af97f7366c6afa35e391e0/uriloader/exthandler/WebHandlerApp.sys.mjs)
  uses `encodeURIComponent(aURI.spec)` and string replacement of the first `%s`.
  Its own credential-removal code currently handles only ftp/ftps/sftp and
  retains a TODO for other URI types. Browlet follows HTML/Chromium's general
  credential-removal rule already approved for this slice. These are inspected
  source paths, not an end-to-end browser navigation probe.

The method does not invoke selection, choose a default, or navigate a page.
`UserAgent.shouldHandleURLExternally()` still explicitly throws, and invocation
step 9 needs navigation's chosen destination and task context. No route bypasses
those unfinished owner decisions merely because a destination can be constructed.

### WebDriver registration-mode command

[Set RPH Registration Mode](https://html.spec.whatwg.org/multipage/system-state.html#set-rph-registration-mode)
now has its command body on `UserAgent.webDriver`. Eric approved the synchronous
`setRPHRegistrationMode(parameters, session)` entry with decoded Infra `JSONValue`
and the existing success/error records. It validates the JSON object and exact
`autoAccept`, `autoReject`, or `none` string, obtains the current browsing
context's active Document, updates its mode, and returns success with null.
Additional JSON properties are ignored; errors leave the existing mode intact.

WebDriver's [processing model](https://w3c.github.io/webdriver/#processing-model)
requires active-session admission before the command. The approved
`checkActiveSession(session)` dependency runs before HTML's body validation;
`getCurrentBrowsingContext(session)` runs only after valid parameters. Both
remain named throwing dependencies. Session IDs, active HTTP ownership, request
queueing, selected frame/window lookup, closure, HTTP routing, and response
envelopes remain automation-owner work. A context returned successfully must have
an active Document; an incomplete owner result raises `InternalError`. The
existing registration-time automation verification remains independently required.

The 29 new command cases cover JSON/mode validation, admission order, protocol
errors, synchronous results, session-selected Documents, navigation replacement,
and connection to accepted/declined registration decisions. The new cases and
adjacent BiDi/registry suites pass together: 61 tests on Node 26.8.1 compat.
This synchronous command changes no engine, realm, or task behavior, so validation
does not repeat the runtime matrix. No expected failures or skips were added.

### Closing custom-handler audit

Audited all of [§8.10.1.4](https://html.spec.whatwg.org/multipage/system-state.html#custom-handlers),
including security/privacy and automation, on 2026-11-06 against local HTML
`5fcc2318395821db61e353705e6368ad9a000af5`. The local algorithms have no additional
unimplemented steps outside the owner dependencies below. This closes the local
audit, not end-to-end protocol-handler support.

| Requirement | Implemented coverage | Remaining owner work |
| --- | --- | --- |
| Secure Window API and conversion | NavigatorContentUtils IDL, Navigator forwarding, and Binding receiver/argument conversion | None in this section; workers correctly omit the mixin |
| Shared normalization | Exact 24-scheme safelist, ASCII `web+` suffix, placeholder, encoding/base parsing, HTTP(S) and same-origin checks | Approved conflicts above remain recorded; secure exposure plus same origin supplies the trustworthiness precondition |
| Parallel registration | Captured normalized pair and originating Document; browser-owned pending/accepted/declined decisions | Consent/admission host and durable storage |
| Parallel removal | Exact-pair removal, remembered-decline removal, pending-result invalidation | Future persistence and consent-UI cancellation integration |
| Invocation steps 1–8 | Accepted-pair/scheme checks, copied credentials, serialization, component encoding, first substitution, parsing | Handler selection precedes this helper; step 9 still needs destination selection and navigation |
| Per-Document automation | Default `none`, mode sampled during registration, independent automation verification | Verified controlling session |
| Set RPH Registration Mode | JSON/mode validation, current active Document update, synchronous success with null | Session admission, context lookup/lifecycle, HTTP dispatch and response transport |

Remaining §8.10.1.4 work is explicit:

- Durable storage/restore across UserAgent lifetimes and host registration are
  not implemented. This registry is explicitly in-memory, as approved.
- Consent/admission policy, UI, prompt cancellation and broader anti-spam policy
  are unfinished; the named consent dependency still throws.
- §8.10.1.4.2's WebDriver command body is implemented. Active-session admission,
  current-session browsing-context lookup, and registration-time automation
  verification remain explicit throwing dependencies; request dispatch and
  transport are not implemented. See the
  [automation boundary](../automation/README.md#current-separation).
- Invocation's URL preparation is implemented, but choosing an accepted handler,
  selecting its destination navigable, and performing navigation are still
  unfinished. Navigation's existing external-handler selection remains an
  explicit throwing owner boundary; this slice does not bypass it.

[§8.10.1.4.1](https://html.spec.whatwg.org/multipage/system-state.html#security-and-privacy)
also constrains those owners. Normalization rejects core schemes such as HTTP(S),
and registration stores a candidate without selecting a default or invoking it.
Remembered decisions suppress repeated exact-pair prompts; cross-site or
many-handler spam remains consent-host policy. Safe presentation of untrusted
handler text, null/escape characters and long strings, and keeping rejection
controls usable belong to `requestProtocolHandlerConsent()`. Administrator
restrictions on data leaving through a handler belong to admission and selection.
The throwing host comments now name these obligations explicitly.

`UserAgent.shouldHandleURLExternally()` and
`Navigable.createDocumentForInlineContent()` remain the existing navigation
boundaries. Neither currently selects a registered pair or connects
`getInvocationURL()` to navigation. That integration must establish the chosen
handler, destination navigable, navigation task/lifetime, and applicable policy
before either boundary can be completed. No default or OS handler is silently
chosen by the implemented registry.

The focused tests cover both operations, secure-context exposure, every safelisted
scheme, validation order and errors, URL normalization and discarded placeholders,
base/encoding capture, argument conversion, borrowed method/receiver realms,
Window-only exposure, exact-pair decisions, duplicate requests, host failures and
retry, removal/replacement races, per-Document modes, browser isolation, and the
explicit consent/verification dependencies. Two assertions for the former
registration/removal stubs were replaced by coverage of those now-implemented
owner operations and their remaining dependencies. No expected failures or skips
were added. The browser-only Chromium failure remains recorded as a failure.

The registration slice's 45 cases passed on Node 24.19.0, 26.8.1, and custom 27 in
stock/compat modes. Invocation adds 14 focused cases for encoding, Unicode,
credential copying, first-token replacement, placeholder locations, accepted-pair
checks, and independent result records. All 59 protocol-handler cases plus the
28 existing URL-encoding cases pass on Node 26.8.1 compat. This synchronous URL
preparation slice changes no realm, scheduler, or native behavior, so it does not
repeat the runtime matrix. Platform declarations, typecheck, focused lint,
import boundaries, and whitespace checks are also checked for this slice.

This closing pass changes documentation and dependency comments only; it retains
the passing focused validation above without repeating runtime tests. No new
browser policy, expected failure, skip, or callable contract was introduced.

## Cookies

[§8.10.1.5](https://html.spec.whatwg.org/multipage/system-state.html#cookies)
was audited against the same HTML revision on 2026-11-06. `NavigatorCookiesMixin`
reads `env.userAgent.cookiesEnabled`, the existing policy used by Fetch's request
and response cookie processing and `Document.cookie`. Navigator composes and
forwards the mixin; its IDL adds the readonly boolean only to Window's Navigator.
There is no second flag, mixin constructor, new configuration option, or queued
notification. Changes to the existing policy are visible immediately.

The default remains true. The value describes cookie handling being enabled; it
does not promise that a particular Document or cookie can store data. Existing
cookie-averse, origin, Secure, domain/path, expiry, and SameSite rules still apply
at their owners. The getter does not try writing a test cookie. Disabling the
policy continues to preserve the store while suppressing sending/acceptance.

`SPEC_CLASH(navigator-cookies-detached)`: Eric approved retaining the live
UserAgent policy for a Navigator after context detachment, following HTML's
browser-wide wording and Firefox. Chromium and WebKit instead return false after
the frame is removed. The [browser-only probe](../../../node-compat/experimental/browser-probes/html/navigator-cookies.mjs)
and [results](../../../node-compat/experimental/browser-probes/html/NAVIGATOR-COOKIES-RESULTS.json)
record Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. All three expose the
ordinary readonly getter in HTTP and HTTPS pages and report true on the tested
data URL even though its cookie assignment does not store a cookie. Their getter
descriptors and absent mixin constructor agree. This probe does not emulate
browser-specific cookie settings or establish third-party/permission policy.

Nine focused cases cover exposure, readonly/receiver checks, live policy changes
shared with Document and Fetch, independent UserAgents and borrowed getter realms,
retained receivers, navigation, cookie-averse Documents, and dedicated/shared
worker exclusion. The detachment case supplies the missing lifecycle owner's
state directly; it does not claim to implement iframe startup or recursive
destruction. All 64 tests in the focused Navigator/Document/Fetch run pass on
Node 26.8.1 compat. This getter adds no engine, scheduler, or native dependency;
no runtime matrix repetition, expected failures, or skips were added.

This slice stopped before §8.10.1.6; the subsequent compatibility implementation
is described below.

## PDF compatibility

[§8.10.1.6](https://html.spec.whatwg.org/multipage/system-state.html#pdf-viewing-support)
is implemented against HTML revision `5fcc2318395821db61e353705e6368ad9a000af5`.
The local reference is clean and matches the official standard's 6 November
update. This section describes capability reporting and legacy compatibility
objects; it does not supply a PDF reader or renderer.

`NavigatorPluginsMixin` retains one PluginArray and one MimeTypeArray for the
Window Navigator. `pdfViewerEnabled` reads the existing `UserAgent.pdfViewerSupported`
flag used by document dispatch; `javaEnabled()` returns false. The default flag
remains false, yielding empty collections. Window owns the specified five plugin
objects and two MIME objects when support is configured. All lookup paths share
those objects, and every MIME object's enabledPlugin is the generic PDF Viewer.
Ordinary Web IDL provides conversion, nonconstructible Window-only interfaces,
indexed properties, unenumerable named properties, iteration, and realm identity.
No plugin discovery, host registry, or parallel task was introduced.

Approved choices and evidence:

- `SPEC_CLASH(navigator-pdf-mime-identity)`: Follow HTML/Firefox's shared Window
  MIME objects. Chromium returns fresh objects on repeated plugin reads and ties
  enabledPlugin to that plugin; WebKit retains separate MIME objects per plugin.
- `SPEC_CLASH(navigator-plugins-detached)`: Keep the Navigator's SameObject
  collections after frame removal, following HTML/Chromium/WebKit. Firefox
  replaces the collection objects; it does not return null. Previously retained
  collections and entries remain usable in all three engines.
- `SPEC_CLASH(navigator-pdf-detached)`: Keep reporting the UserAgent's support
  value after removal, following HTML/Firefox/WebKit. Chromium reports false
  while its retained collections remain populated.
- `SPEC_CLASH(navigator-plugins-refresh)`: Follow HTML's zero-argument no-op.
  Chromium still accepts an optional reload argument. The initial probe's truthy
  argument reloaded the page and destroyed its evaluation context; this was not
  a browser crash. Blink's `DOMPluginArray::refresh(bool)` confirms that path.
- `SPEC_GAP(navigator-pdf-preference-lifetime)`: Configure support before creating
  a Window, and retain its lists for that Window's lifetime. HTML provides no
  notification or refresh algorithm for a live preference change. Eric approved
  this boundary; a future host preference-update contract must address existing
  Windows. The boolean getter still reads the UserAgent flag.

The [browser-only probe](../../../node-compat/experimental/browser-probes/html/navigator-plugins.mjs),
[results](../../../node-compat/experimental/browser-probes/html/NAVIGATOR-PLUGINS-RESULTS.json),
and [initial run](../../../node-compat/experimental/browser-probes/html/NAVIGATOR-PLUGINS-INITIAL-RESULTS.json)
preserve the evidence. Versions were Chromium 156.0.8078.4, Firefox 157.0, and
WebKit 27.2. Chromium's headless shell reports no viewer; full Chromium's headless
mode exposes the populated branch. Firefox was probed with pdfjs.disabled both
false and true. No actual PDF navigation or rendering was exercised by the probe.

Fourteen focused tests cover HTTP/HTTPS exposure, empty/populated collections,
fixed metadata, lookup identity, legacy property descriptors, Web IDL conversion,
invalid receivers, no-op refresh, retained receivers, replacement Windows,
borrowed-method realms, and dedicated/shared worker exclusion. The detachment
test supplies the lifecycle state directly; it does not implement iframe
destruction. The compatibility tests and existing navigation-dispatch tests pass
together (59 tests per run) on Node 26.8.1 stock and compat. Typecheck and focused
lint pass. This slice reuses Binding's existing legacy-property and projection
machinery; no engine, scheduler, or addon implementation changed.

The remaining dependencies are already explicit:

- `Navigable.createDocumentForInlineContent()` still throws. It owns the missing
  inline document, PDF decoding/rendering, and loader completion path; setting
  the support flag does not supply that implementation.
- External PDF handling still reaches UserAgent's throwing external-software
  handoff. No viewer installation or OS integration is inferred from these APIs.
- A live PDF preference-change mechanism remains with the future host. There is
  no public BrowletConfig viewer option or automatic refresh of existing Windows.

This closes the local §8.10.1.6 compatibility surface. The next HTML section is
§8.11 Images; NavigatorConcurrentHardware remains with the worker/hardware owner.

## Removal condition

Burn this file once each Navigator family has implemented source or an
explicit host capability and Window/worker identity is tested.
