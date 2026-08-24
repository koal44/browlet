# Browsing roadmap

## Present

- `origin.ts` implements the origin/site comparisons currently required by
  agents, navigation, and Window security decisions.
- `browsing-context.ts`, `navigable.ts`, and `document-lifecycle.ts` form the
  bounded top-level navigation spine.

## Missing structural concepts

| Planned source | Contract | Specification |
| --- | --- | --- |
| existing `origin.ts` and Document integration | Complete opaque/tuple origin and site operations, `Origin`, and the constrained `document.domain` setter | HTML §7.1.1 |
| `site.ts` if origin.ts becomes crowded | Sites and schemeless same-site operations | HTML §7.1.1.1 |
| `agent-cluster-key.ts` only if it no longer belongs in scripting | Origin-keyed agent-cluster selection | HTML §7.1.2 |
| `browsing-context-group.ts` if group behavior outgrows browsing-context.ts | Browsing-context groups and related group switching | HTML §§7.1 and 7.3.2 |
| existing `navigable.ts` | Child/related navigables, destruction, container association, active/current-entry invariants, and the derived fully-active-Document predicate | HTML §§7.3.1–7.3.3 |
| `target.ts` | Choosing/naming browsing contexts and navigables | HTML §7.3.1 |
| existing `document-lifecycle.ts` | Shared Document creation plus ordered finish, unload, destroy, abort, event, realm-cleanup, and navigable-detachment behavior | HTML §7.5 |
| existing `user-agent.ts` plus the future embedder/automation boundary | Browser-UI navigation, reload, stop, traversal, creation, closing, POST confirmation, and cache-bypass requests routed through the ordinary algorithms with `browser UI` involvement | HTML §7.9 |

## Section 7 invariants

- A browsing context owns the stable WindowProxy and the series of Windows it
  exposes. It does not own session history.
- A navigable owns its current and active session-history entries; its active
  Document and browsing context are derived through the active entry.
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

Blink distributes these responsibilities between `core/frame`,
`core/execution_context`, and `platform/weborigin`. Browlet's `browsing/`
boundary intentionally reunites the HTML-owned lifecycle while leaving
JavaScript execution under `scripting/`.

## Removal condition

Burn this file when nested/auxiliary context ownership and target selection
are implemented or tracked by a narrower surviving roadmap, and active versus
fully-active Document state has one authoritative derivation.
