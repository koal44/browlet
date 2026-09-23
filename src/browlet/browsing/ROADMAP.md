# Browsing roadmap

## Present

- `origin.ts` implements the origin/site comparisons currently required by
  agents, navigation, and Window security decisions.
- `browsing-context.ts`, `navigable.ts`, and `document-lifecycle.ts` form the
  bounded top-level navigation spine.
- `navigable.ts` derives a node's navigable and a top-level Document's
  fully-active status from the navigable's active session-history entry.

## Missing structural concepts

| Planned source | Contract | Specification |
| --- | --- | --- |
| existing `origin.ts` and Document integration | Complete opaque/tuple origin and site operations, `Origin`, and the constrained `document.domain` setter | HTML §7.1.1 |
| `site.ts` if origin.ts becomes crowded | Sites and schemeless same-site operations | HTML §7.1.1.1 |
| `agent-cluster-key.ts` only if it no longer belongs in scripting | Origin-keyed agent-cluster selection | HTML §7.1.2 |
| `browsing-context-group.ts` if group behavior outgrows browsing-context.ts | Browsing-context groups and related group switching | HTML §§7.1 and 7.3.2 |
| existing `navigable.ts` | Child/related navigables, destruction, container association, active/current-entry invariants, and fully-active recursion through the container Document | HTML §§7.3.1–7.3.3 |
| `target.ts` | Choosing/naming browsing contexts and navigables | HTML §7.3.1 |
| existing `document-lifecycle.ts`, `NavigationParams`, and `DocumentImpl` | Creation factory selects Window/realm; navigation owns response/destination operations; Document owns initialization, loading completion, destruction, abortion, and unloading cleanup | HTML §7.5 |
| existing `user-agent.ts` plus the future embedder/automation boundary | Browser-UI navigation, reload, stop, traversal, creation, closing, POST confirmation, and cache-bypass requests routed through the ordinary algorithms with `browser UI` involvement | HTML §7.9 |

## Section 7 invariants

- A browsing context owns the stable WindowProxy and the series of Windows it
  exposes. It does not own session history.
- A navigable owns its current and active session-history entries; its active
  Document and browsing context are derived through the active entry. Its
  constructor requires a document state with a present Document, establishes
  both entries, and associates that Document. Callers cannot retain an
  uninitialized navigable. Retained history state still permits null after
  document discard; that later absence does not weaken constructor inputs.
- Navigation commit must update the active entry, Document-to-browsing-context
  association, Window-to-Document association, and WindowProxy target as one
  coherent transition. The current convenience accessors must never become
  competing sources of active-Document truth.
- A traversable owns the coordinated session-history list, traversal queue,
  system visibility, and cross-document focus. The UserAgent owns top-level
  traversables and browsing-context groups.
- Whether a Document is active or fully active must be derived from those
  relationships. Do not add an independently mutable `fullyActive` flag that
  can disagree with navigation commit or traversal.
- Worker owner liveness and deferred `storage` event delivery consume that same
  fully-active predicate. Neither subsystem may cache an independent notion of
  whether a Document currently participates in its traversable.
- Policy containers, origins, and history/document state retain their
  specified identity or cloning semantics as they pass through navigation
  records. Ad hoc subsets copied into Window or loader state would make
  history restoration inconsistent.
- Browser UI and future automation commands enter through the same navigation,
  reload, traversal, stop, and close algorithms as author-facing APIs. The
  embedder supplies intent and confirmation UI, not a parallel lifecycle.
- Destroying a Document must hand lifecycle cleanup to its owning subsystems,
  including canceling queued tasks, disentangling MessagePorts, removing the
  Document from worker owner sets, and terminating its worklet globals.
  Browsing owns the ordering; each subsystem owns its internal state.
  Reporting adds global endpoints, outbound reports, observer registrations,
  and its report buffer to that cleanup. Do not clear them merely when the
  Document becomes inactive; [Reporting B](../reporting/ROADMAP.md#b-generation-observers-and-user-controls)
  leaves destruction integration explicitly outstanding.

## Document destruction review

Reporting B is the immediate consumer. HTML §7.5.10's single-document destruction
calls §7.5.11's load abortion and §7.5.9's shared unloading cleanup. The full
unload algorithm is a separate caller: its pagehide/unload events, visibility,
timing, and back/forward-cache decisions are not prerequisites for expressing
destruction itself.

`DocumentImpl.destroy()`, `abort()`, and `runUnloadingCleanup()` contain the
single-document algorithms. Missing subsystem integrations have reviewed
`PROVISIONAL` declarations: empty typed collections, a nullable parser, and
explicit no-op operations. These make the lifecycle code executable without
claiming those producers exist. Navigation does not invoke destruction yet.
`test/browlet/browsing/document-destruction.test.ts` covers active-document
destruction, registered cleanup calls, parser abortion, and BiDi notification
arguments through those provisional contracts.

Ready independently: document salvageability/blocking-reason state,
`EventLoop.removeTasksForDocument()`, `GlobalTimers.clear()`, and global
`clearReportingState()`. Focused tests cover task ownership, queued and delayed
timer cancellation, and isolation of report state between globals.

| Provisional dependency | Required owner and behavior |
| --- | --- |
| `environment.fetchGroup.cancel()` | Currently returns false without changing records. Fetch must cancel in-flight work, discard its queued callbacks and subsequent data, and report whether anything was canceled. Existing `terminate()` only changes controller state and processes deferred fetches; it excludes keepalive requests. Settle cancellation/lifetime rules with Fetch orchestration. No DOM types should enter Fetch. |
| `document.activeParser` and `parser.abort()` | HTML parser integration must track an actually active parser, stop its input and resumptions, and perform §13.2's abort readiness/stack steps. The current `document.write()` callback does not supply this lifetime. |
| `userAgent.webDriverBiDiNavigationAborted()` | A no-op until BiDi sessions exist. The lifecycle call supplies the navigation ID, canceled status, URL, and navigable. UserAgent also owns the environment-scoped BiDi queries. |
| Global `messagePorts` | Messaging must maintain relevant-global membership and disentangle those ports. MessagePort itself is not implemented. |
| Global `webSockets`, `webTransports`, `eventSources` | Those subsystems must own their live objects and cleanup operations. They are not current runnable producers. |
| `document.ownedWorkers` / `workletGlobalScopes` | Worker and Worklet integration must maintain actual ownership, remove the Document from worker owner sets, and terminate document-owned worklets. |
| `userAgent.blobURLStore` | The storage-keys/Blob-URLs detour must implement File API's environment-based unloading cleanup. Other unimplemented cleanup producers remain with their own specifications. |

The global collections and inline structural types are deliberately minimal.
Replace them with concrete subsystem types and actual registration when those
owners are implemented; do not introduce parallel registries then.
They stay on the WindowOrWorkerGlobalScope mixin because these resources are
available to both global types. Document and worker lifecycle algorithms remain
responsible for their respective teardown ordering and conditions.

Two lifecycle questions remain before general use:

- Our node-navigable lookup reaches the browsing context, so destruction retains
  the active document state before clearing that association. HTML instead
  defines the lookup by the active Document. Its destroy step assumes an active
  history entry, while its document-state rules permit discarding Documents
  that are not fully active.
  Identify the owning retained history state for that case before implementing
  inactive destruction; `destroy()` explicitly rejects it for now. WebKit's
  `history/CachedFrame.cpp` destroys its retained `m_document`; Gecko's
  `docshell/shistory/nsSHistory.cpp` evicts the loader retained by the selected
  history entry. These support retaining the disposal target independently of
  the currently active entry. Settle our callable shape in the dedicated
  history-ownership slice below, not as a Reporting-specific parameter. The local HTML
  inconsistency is recorded in `scratch/SPEC-ISSUES.md`.
- Reporting defines best-effort delivery and retirement, but no explicit
  document-destruction flush. The provisional implementation discards local report state after
  removing document tasks. Slice C must settle any handoff of pending outbound
  reports before this cleanup is used in production. Destroying a Document must
  not erase an unrelated or reused Window's state. Blink's
  `core/frame/reporting_context.cc` hands reports to the reporting service when
  generated; Gecko's `dom/reporting/ReportDeliver.cpp` captures delivery data
  then; WebKit's `loader/PingLoader.cpp` uses keepalive for violation reports.
  For Reporting C, hand delivery data to its owner while the global is alive,
  so document cleanup does not erase pending delivery or require a synchronous
  network flush.

### Planned slice: history ownership and document disposal

Review this as HTML browsing work across §§7.3, 7.4, and 7.5.9–7.5.11 before
extending the provisional `Document.destroy()` API. Reporting is one cleanup
consumer; it must not dictate history ownership or cache eviction policy.

- Establish retained DocumentState identity, including sharing across
  same-document entries. Distinguish removing an entry from discarding its
  cached Document while preserving enough state for later recreation.
- Trace navigation commit, active/current entries, restoration, browsing-context
  changes, and initial about:blank Window reuse before deciding how a destruction
  caller identifies the state to clear.
- Include nested histories and the old Document's child navigables. Add the
  descendant wrappers with their owner tasks and completion ordering; do not
  substitute the currently displayed page's frame tree.
- Integrate unload/abort/destroy ordering with the callers that require it.
  Inactivity alone is not destruction, and cleanup must preserve another
  Document's live Window resources and pending work.

Exit cases include A→B followed by eviction of A while B remains usable;
returning to A by recreation; shared same-document history state; descendant
teardown; and initial about:blank Window reuse. Any missing dependency is shown
at that consumer rather than hidden by extra nullable lookups or a second owner
registry. Keep the current active-document scaffold provisional until those
relationships and callers exist. Reporting C's independent serialization,
retirement, and delivery-ownership work does not require this slice to finish.

## Lifecycle completion order

1. Complete active/current-entry invariants and the fully-active predicate.
2. Replace the synchronous route path with response-bearing navigation,
   cancellation, task timing, and ordered finish/abort/unload/destroy steps.
3. Use `iframe` to add child navigables, ancestry, policy inheritance, load
   propagation, and same-/cross-origin WindowProxy behavior.
4. Add auxiliary top-level traversables through the same creation path,
   including opener relationships and Storage's legacy clone of the opener's
   traversable storage shed.
5. Complete centralized history mutation and traversal before exposing the
   full History and Navigation APIs.
6. Add page-swap/reveal restoration and speculative loading after the core
   lifecycle is asynchronous and stable.

Nested and auxiliary browsing contexts should be added through navigable and
group algorithms, not by widening the current top-level special case.
`HTMLIFrameElement` is the first concrete nested consumer and should prove
creation, removal, WindowProxy identity, policy inheritance, and child load
propagation before auxiliary windows are added.

Referrer Policy already follows a srcdoc Document's browsing context to its
navigable's container and that element's node Document. `Navigable.container`
provisionally returns null; replace it with the actual content-navigable
association during child creation/destruction. The loaded-srcdoc referrer case
in `test/browlet/scripting/environment.test.ts` is an expected failure until
this lifecycle exists. Add nested-srcdoc and inactive-container-Document cases
at that point; `parent.activeDocument` is not an equivalent relationship.

Blink distributes these responsibilities between `core/frame`,
`core/execution_context`, and `platform/weborigin`. Browlet's `browsing/`
boundary intentionally reunites the HTML-owned lifecycle while leaving
JavaScript execution under `scripting/`.

## Removal condition

Burn this file when nested/auxiliary context ownership and target selection
are implemented or tracked by a narrower surviving roadmap, and active versus
fully-active Document state has one authoritative derivation.
