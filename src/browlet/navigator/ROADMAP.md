# Navigator roadmap

HTML §8.10 defines `Navigator` as a per-global facade assembled from multiple
capability mixins. It should not become a miscellaneous owner for the network,
cookies, permissions, or host platform; those subsystems supply its answers.

The current slice supplies Window's stable Navigator identity, its
`clientInformation` alias, a forwarding `storage` getter, and its retained
`permissions` object. Pointer Events §6 also contributes `maxTouchPoints`, whose
getter selects an environment-scoped BiDi override before querying its UserAgent
for device capacity. The hardware query explicitly throws until the native input
host exists; the BiDi selector returns null while there are no active sessions.
The [Pointer Events audit](../interaction/events/ROADMAP.md#pointer-events-6-navigator-touch-capacity)
records the required host result and pending automation algorithm. The HTML capabilities
listed below remain pending except for this identity and its IDL composition.

| Planned source | Contract | Specification |
| --- | --- | --- |
| `navigator.ts` | Stable Window `navigator` identity and common Navigator object state | HTML §8.10.1 |
| `identification.ts` | `NavigatorID` compatibility values and user-agent capability | HTML §8.10.1.1 |
| `language.ts` | `NavigatorLanguage` and ordered language preferences | HTML §8.10.1.2 |
| `online.ts` | `NavigatorOnLine` plus environment connectivity transitions and events | HTML §8.10.1.3 |
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
Worker partial when implemented. Storage's `persist()` uses the same permission owner.

For `NavigatorID.userAgent`, call Fetch's `getEnvironmentDefaultUserAgent()`
with this Navigator's relevant settings object, as HTML prescribes. Browlet's
UserAgent already owns the configured default; the settings supply the scoped
BiDi query. Reporting and request-header insertion use the same selector.
Do not introduce a second identification value on Navigator or its environment.

Blink likewise keeps a base Navigator/WorkerNavigator in core while feature
modules contribute separate IDL mixins. Browlet should preserve that extension
shape instead of accumulating every future API in `navigator.ts`.

## Removal condition

Burn this file once each Navigator family has implemented source or an
explicit host capability and Window/worker identity is tested.
