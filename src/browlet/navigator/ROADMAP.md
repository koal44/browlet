# Navigator roadmap

HTML §8.10 defines `Navigator` as a per-global facade assembled from multiple
capability mixins. It should not become a miscellaneous owner for the network,
cookies, permissions, or host platform; those subsystems supply its answers.

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

Blink likewise keeps a base Navigator/WorkerNavigator in core while feature
modules contribute separate IDL mixins. Browlet should preserve that extension
shape instead of accumulating every future API in `navigator.ts`.

## Removal condition

Burn this file once each Navigator family has implemented source or an
explicit host capability and Window/worker identity is tested.
