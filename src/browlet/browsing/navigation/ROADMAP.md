# Navigation roadmap

This component owns browsing contexts, navigables, document creation, and
session history. It shares the `browsing/` family with `window/` and `policy/`;
outside consumers use its index, while its modules import each other directly.

## Present

- `browsing-context.ts` retains context/group relationships and creates the
  initial Window and about:blank document through the UserAgent's factory.
- `Navigable` prepares response policy inputs, selects the browsing context and
  Window/realm, and creates the destination document and history entry.
  `loadHTMLDocument()` starts HTML parsing and coordinates completion or abortion.
  Its bounded cross-document commit activates the entry; `Traversable` applies
  the history step and clears forward entries.
- `session-history.ts` models entries and nested histories for the active
  top-level traversable; `document-state.ts` retains their document/reload state.
- `params.ts` carries response, policies, and timing. The destination is the
  Navigable receiving those inputs, so params need no reference back to it.

The navigable survives changes of Document, Window, and environment. Preparing
a response can create a new environment while the old document remains active;
consumers use the created document's environment, not a stored environment on
the navigable. Initial about:blank creation still starts in `BrowsingContext`
before that document is used to initialize a navigable. The HTML response
handler uses the lower-level `loader/ResourceReader` to consume bytes and
`html/parser/HTMLDocumentParser` to parse them in the document's environment.

## Missing

| Planned source | Contract | Specification |
| --- | --- | --- |
| `history.ts` | `History`, `ScrollRestoration`, state serialization through `scripting/structured-data/`, length/state/go/back/forward, and push/replace state | HTML §7.2.5 and §2.7 |
| `navigation-api.ts` | `Navigation`, results/options, destination, entries, ongoing navigation, intercept/precommit controllers, transition, activation, and focus/scroll behavior | HTML §7.2.6 |
| `navigation-history-entry.ts` | `NavigationHistoryEntry`, keys/IDs/state, disposal, and same-document identity | HTML §7.2.6 |
| `navigation-events.ts` | `NavigateEvent`, current-entry-change, navigate success/error, destination and intercept/precommit callback surfaces | HTML §7.2.6 |
| `lifecycle-events.ts` | `PopStateEvent`, `HashChangeEvent`, `PageSwapEvent`, `PageRevealEvent`, `PageTransitionEvent`, and `BeforeUnloadEvent` | HTML §7.2.7 |
| `not-restored-reasons.ts` | `NotRestoredReasonDetails`, recursive `NotRestoredReasons`, and history-entry association | HTML §7.2.8 |
| `traversal.ts` | Traversal queue, apply history step, back/forward/reload | HTML §§7.4.1, 7.4.3, and 7.4.6 |
| `document-state.ts` / `session-history.ts` | Complete document/session-history state and persisted user state | HTML §§7.4.1–7.4.2 |

Existing modules still need fragment navigation, `javascript:` URLs,
download/POST handling, nested navigables, reload, traversal, unloading,
ongoing-navigation cancellation, and full history-step application (HTML
§7.4).

Document now retains the §3.1.5 `previousDocumentUnloadTiming` record with zero
defaults. The unloading/navigation algorithms must capture the old document's
unload-event start/end times and supply them to the destination document;
allocation of the record does not implement that producer.

Document implements [§3.1.3 ancestor-origin snapshots](../../html/ROADMAP.md#section-313-ancestor-origins).
Child navigation must supply the navigable/container association, fully-active
ancestry, and iframe referrer policy. `Navigable.container` throws for children
until that association exists. Creation passes the known container document to
ancestry initialization before activation, or uses the embedder's node document
before an initial navigable exists. Do not substitute the parent navigable's
active document for the embedding element's node document.

The [resource metadata slice](../../html/ROADMAP.md#section-314-resource-metadata)
retains `Document.cookieURL` independently of the document and base URLs.
`NavigationParams.cookieURL` starts with the response URL. Initial blank creation
copies the creator's cookie URL once creator support exists; srcdoc navigation
must capture the embedder's cookie URL, and later blank navigation must capture
the initiator's. Supply those inputs with inherited origin/base/policy state,
including the cookie URL when sandboxing makes the origin opaque. That allows
the cookie accessor to throw rather than silently deny sandboxed srcdoc access.
Do not recover the URL from an origin or consult the live parent on each access.
History restoration must retain it when recreating a Document, while
push/replace-state and fragment changes leave it alone. See
[WHATWG HTML #332](https://github.com/whatwg/html/issues/332) and the approved
clashes in the metadata audit.

Navigation/form request construction must set Fetch's `isFormSubmission` for
GET and POST forms, so Upgrade Insecure Requests can distinguish cross-origin
forms from ordinary links. At both navigation-download and hyperlink-download
handoff, apply `response.isMixedDownload(sourceDocument.url, env)` to the full
response URL list before accepting the download. The policy algorithms and
reviewed upgrade choices are tracked in the [policy roadmap](../policy/ROADMAP.md#mixed-content-and-upgrade-insecure-requests).

All push, replace, traversal, reload, and cross-/same-document commits must
converge on the centralized session-history modification and history-step
algorithms. Public History or Navigation methods must not mutate the arrays
directly, even while only a single top-level traversable is supported.

Blink spreads this path across `core/frame` and `core/loader`; Browlet keeps
the state machine here while response acquisition and resource loading belong
in `loader/`.

## Removal condition

Burn this file once all supported navigation kinds share the specified
history-step machinery and the public History/Navigation APIs exist.
