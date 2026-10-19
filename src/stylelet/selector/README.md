# Stylesheet selector matching

This folder matches Stylelet's parsed selector records against host elements.
It is separate from Selectlet's DOM query engine. Both use Infra's
`DOMOperations`; matching a stylesheet rule also needs specificity and eventually
style-tree/pseudo-element context that a DOM query result does not provide.

## Current path

[syntax/selector.ts](../syntax/selector.ts) parses component values into selector
records, with optional namespace and parent-nesting context. Those records
retain specificity and serializer information. Forgiving lists can retain an
`UnparsedSelector` arm for serialization; it contributes neither a matcher nor
specificity.

[matchSelectorList()](match.ts) returns the greatest specificity among matching
arms, or null. It compiles compounds and combinator chains using
[emit.ts](emit.ts), [candidate.ts](candidate.ts), and [chain.ts](chain.ts).
Nested `&` uses its bound parent expansion; without one it behaves as `:scope`.

[runtime.ts](runtime.ts) reads attributes, language, directionality, tree
relationships, and available host state through DOMOperations. Shared ASCII
and host-language helpers already live in Infra's
[selector-matching.ts](../../infra/selector-matching.ts); the two engines do
not need another DOM adapter merely to share an algorithm.

## Cache ownership

[StyleletContext](../context.ts) caches compiled arms by selector-object identity
and retains regex/runtime caches. Matchers needing tree caches synchronize
against the host's optional `treeVersion`; without that provider, that cache
path is disabled. This is not a computed-style cache or a complete style
invalidation system.

## Current limits

- Stylelet's context is document-based; `root` is the document element.
  Featureless-host predicate machinery exists, but stylesheet shadow-tree
  context and `@scope` roots/limits are not connected.
- The current element matcher rejects pseudo-element subjects. Parsing
  `::before`, `::part()`, or `::slotted()` does not make those subjects available
  to the cascade.
- Grammar coverage exceeds runtime coverage. For example, `:nth-child(... of
  selector)` parses but the emitter currently returns no match for that form.
  Several Selectors 5/state-dependent forms also lack runtime behavior.
- `:focus-visible` currently uses focus as an approximation; some media-state
  predicates return no match. `:visited` is deliberately hidden in the current
  matcher. Rendering/history behavior needs a distinct privacy-aware contract.
- Stylesheet interpretation supplies no `@namespace` context, despite parser
  and matcher tests that explicitly supply namespace mappings.

The [roadmap](ROADMAP.md) records these boundaries without treating a valid
selector grammar or passing parser test as complete styling support.

## The Selectlet boundary

| Concern | Stylelet | Selectlet |
| --- | --- | --- |
| Entry | Parsed selector list plus one host element | String queries through [createSelectlet()](../../selectlet/selectlet.ts) |
| Parsing | CSS tokens/components, specificity, nesting expansion, serialization | Its own lexer/parser with query predicates, costs, and seed information |
| Result | Matching specificity or null | `matches`, `closest`, `first`, and ordered query results |
| Consumers | Stylesheet cascade | Browlet's DOM query APIs and standalone query hosts |
| Shared facilities | Infra DOMOperations and low-level matching helpers | The same host-neutral facilities, with its own query context/cache lifecycle |

These are different contracts, but some algorithm bodies overlap. Sharing is
an open review, not a decision to merge parsers or make stylesheet matching
call the string query API. Preserve namespace/nesting context, scope, privacy,
and matching specificity in any future change.

## Evidence

The [matcher tests](../../../test/stylelet/unit/selector/match.test.ts) exercise
ordinary/nested matching, specificity, namespace resolution, forgiving arms,
and cache selection. Selector syntax/serialization and Selectlet parser suites
also passed in the [syntax and selector baseline](../README.md#syntax-rules-and-selectors).
That baseline excludes browser scenarios and a full selector conformance run.
