# Stylelet

Stylelet supplies CSS parsing, value processing, stylesheet state, and a partial
style engine through a host-neutral DOM boundary. Browlet supplies its document
and element implementations; standalone hosts can supply their own
`DOMOperations` and execution facilities.

The [roadmap](ROADMAP.md) records unfinished work and maps specification families
to their owners. Support varies across parsing, retained state, engine participation and
Platform exposure; the limits below distinguish those layers.

## Entry points and existing layers

[Stylelet](stylelet.ts) composes a `StyleletContext`, `CascadeEngine`, and document
`TreeScope`. Its public entry points create constructed stylesheets and obtain
the current computed-style result. [index.ts](index.ts) exports the supported
entry points and implementation types.

| Home | Existing responsibility |
| --- | --- |
| [syntax/](syntax/README.md) | CSS input, tokens, component values, and generic syntax rules/declarations |
| [css/](css/README.md) | Property declarations, the installed property registry, and declaration storage |
| [selector/](selector/README.md) | Selector parsing, serialization, specificity, stylesheet matching, and its caches; separate from Selectlet's selector engine |
| [values/](values/README.md) | Reusable value grammars, representations, resolution, and serialization, including media queries and supports conditions |
| [value-processing/](value-processing/README.md) | Value stages and shared processing contracts; complete element-level orchestration remains missing |
| [props/](props/README.md) | Seven installed property definitions; color/background-color, opacity, and the four margin longhands. Animation-name has a separate unregistered parser. |
| [conditional/](conditional/README.md) | Roadmap for condition evaluation and applicability; supports capability checks and device/container matching are not implemented |
| [engine/](engine/README.md) | Sheet participation, tree-scope collections, cascade selection, and computed-style construction |
| [cssom/](cssom/README.md) | Rule construction, authoritative stylesheet/rule implementations, collections, and mutation behavior |
| [web-idl.ts](web-idl.ts) | CSSOM declarations and host contributions; adoption's collection binding remains provisional |
| [environment.ts](environment.ts), [context.ts](context.ts) | Host facilities and document/query state, respectively |

Each implemented component has an explicit `index.ts`; imports across its boundary use that
barrel, while collaborating modules inside it import each other directly.
`environment.ts` and `context.ts` remain named entries for their existing owners.
The public [index](index.ts) also exports Infra's `InternalPromise` for standalone
hosts supplying `exec.Promise`. Implementation modules import it directly from Infra.

The provisional [component order](../../scripts/eslint/import-hierarchy.mjs) puts
syntax and value-processing contracts below numeric literals, values, conditions,
property definitions/selectors, declaration data, CSSOM, and the engine. Streams
and Selectlet precede Stylelet; this does not add dependencies on either one.
Selector parsing consumes generic syntax and value grammars from this higher
layer. Supports conditions stay with reusable value grammars; `conditional/`
owns future evaluation and applicability work. `npm run lint:imports` checks
these boundaries; new findings require an ownership review before changing the map.

## Parsing and object construction

Use these responsibilities when adding or reviewing parsing code:

1. **Syntax parsing** in [syntax/parser.ts](syntax/parser.ts) consumes CSS text
   or existing tokens and owns structural recovery. Its typed cursor carries the
   required rule context that makes grammar decisions during consumption.
   Declaration-only and component parsers remain available for narrower grammars,
   including support queries that must retain unsupported declaration syntax.
2. **Property interpretation** in [css/property.ts](css/property.ts) applies
   the installed property grammars and produces `PropertyDeclaration` values.
   `interpretPropertyDeclaration()` supplies the shared grammar step. Stylesheet
   consumption calls it before deciding whether to retry input as a rule;
   `interpretPropertyDeclarations()` applies it to declaration-only syntax lists.
3. **CSSOM rule interpretation** in [cssom/parser.ts](cssom/parser.ts) recognizes
   rule grammars through `StylesheetContext`, producing implementations with
   parsed selectors and interpreted declarations. It selects child grammars
   before entering blocks. Each context method consumes and interprets the whole
   rule; `createStyleRule()` assembles already interpreted declarations and children.

Use plain specification names for syntax records (`Rule`, `QualifiedRule`,
`Declaration`), `interpret…` for applying the relevant grammars, and `…Impl` for
implementations of Platform interfaces. Keep named parsing entry points aligned
with their source algorithms, such as `parseStylesheetContents()`.

These responsibilities cooperate during parsing, rather than requiring complete
independent passes. `CSSStyleSheetImpl` owns the resulting rule tree
and its URL provenance; the engine and CSSOM mutation use that same tree.
There is no retained intermediate stylesheet tree. Core declarations describe
the sheet/rule/declaration interfaces; the host's Binding machinery supplies
their realm-owned Platform objects.

The same distinction applies to declarations. `PropertyDeclaration` is internal
data; `CSSDeclarationBlock` is the current retained data container;
`CSSStyleDeclarationImpl` provides mutation/query behavior, and
`CSSStylePropertiesImpl` supplies the property-facing subtype. Both interfaces
are bound; the existing container and class split remains under review.

Keep implementation contracts in JSDoc, with specification URLs in ordinary
comments. Copied Web IDL belongs in a plain multiline comment immediately above
its `define…` declaration. Describe retained fields by their meaning and ownership,
including private state; mark unfinished behavior explicitly rather than describing
it as implemented.

## Host boundary and state ownership

Stylelet reads nodes through Infra's `DOMOperations`, preserving host node
identity. The existing `StyleletEnvironment` supplies URL construction, decoding,
exceptions, promises, and background/task delivery. Standalone defaults do not
load Browlet's runtime. Browlet passes its existing owning environment through
this contract; see [project architecture](../ARCHITECTURE.md).

`TreeScope` retains ordered stylesheet collections and adopted stylesheets. It
does not retain a computed-style tree. `StyleletContext` caches selectors,
regular expressions, and selector runtime information. The current
[computed-style routine](engine/computed-style.ts) creates a fresh result and
declaration block on each call; it has no live-result invalidation mechanism.

Inline style has a separate lifecycle. Browlet owns attribute notifications and
CSP enforcement; Stylelet owns accepted declaration parsing and mutation. The
cascade reads retained inline data through `DOMOperations.inlineStyleBlock`.
An absent provider allows raw-attribute fallback for standalone hosts; a
provider returning null means authoritative empty state. This distinction keeps
a CSP-blocked raw attribute from becoming active during a style query. See the
[Browlet integration README](../browlet/style/README.md) for the complete path.

Sheet, rule, and declaration members now project through concrete interface
references. Binding also supplies numeric indices and supported-property
attributes. The adopted-sheet collection still uses a provisional `any` member
and an implementation-side observable-array proxy pending the §6.2 audit.

## Current reach

Generic value support is broader than the installed property registry. A value
parser's presence does not imply that a property using it participates in a
stylesheet, cascade, CSSOM access, or computed style.

The CSSOM parser recognizes style rules, including nested style-rule data.
Unknown at-rules are discarded; recognized unfinished grammars stop at explicit
context methods. The cascade visits only top-level style
rules; nested-selector tests do not establish nested-rule participation.
CSSOM's rule objects are less complete:
style declaration edits work, while selector mutation, nested-rule operations,
and rule serialization remain unfinished.

The engine selects supported declarations from inline state and matched sheets.
It does not yet provide the complete cascade/defaulting/inheritance pipeline,
media-dependent sheet participation, or CSSOM's live resolved-value result.
Registered-value helpers and registration lookup exist, but author registration
and per-element custom-property computation are not connected. Arbitrary
substitution reaches an explicit stub; CSS-wide keyword handling is incomplete.
Layout and painting have separate owners. Their facts must be
explicit inputs when required; missing geometry must not become a guessed value
or work performed during serialization.

## Reading and testing

Start with the [CSSOM inventory](cssom/README.md) and
[CSSOM roadmap](cssom/ROADMAP.md) for the current review. Host-specific unfinished
work and existing browser-conflict evidence remain in
[Browlet's style roadmap](../browlet/style/ROADMAP.md).

Implementation suites live under `test/stylelet/unit/`; Browlet integration
suites live under `test/browlet/style/` and CSP's tests. Browser scenarios that
exercise Stylelet are separate from browser-only probes. The CSSOM README
records the focused baseline and distinguishes behavior coverage from tests
that deliberately pin today's storage arrangement.

The folder guides above trace current consumers and their missing contracts.
[Value inputs](values/ROADMAP.md#context-inputs-and-freshness) distinguish existing
resolver fields from missing providers. [Typed OM](cssom/typed/ROADMAP.md) and the
[subsystem roadmaps](ROADMAP.md#source-organization) retain API and delivery work. The
[delivery order](../PRIORITY.md#stylelet-delivery-order) starts with the
CSSOM/inline-style boundary.

## Test baselines

These focused runs passed on 2026-10-19 using custom Node 27.0.0-pre with the
compatibility addon. They record tested behavior, not complete conformance.
They did not include browser scenarios, a full WPT run or performance comparisons.
The [CSSOM baseline](cssom/README.md#validation-baseline) separately covers
declaration, stylesheet and host integration behavior.

### Syntax, rules and selectors

**13 files, 785 tests passed.**

```text
node scripts/with-node.mjs vitest run --project=unit test/stylelet/unit/syntax test/stylelet/unit/css test/stylelet/unit/selector test/selectlet/unit/parser.test.ts
```

Vitest's path filtering also selected the CSSOM stylesheet, stylesheet-list
and media-list suites. This covers parsing/serialization, interpretation and
direct matching, not missing nested-rule cascade traversal.

### Cascade and values

**10 files, 1,222 passed tests, 7 expected failures and 14 skips.**

```text
node scripts/with-node.mjs vitest run --project=unit test/stylelet/unit/engine test/stylelet/unit/values/custom-property.test.ts test/stylelet/unit/values/syntax-value.test.ts test/stylelet/unit/values/numeric-values.test.ts test/stylelet/unit/values/math-value.test.ts test/stylelet/unit/values/first-valid.test.ts test/stylelet/unit/values/if.test.ts test/stylelet/unit/values/values.test.ts
```

The expected failures are seven if-replacement cases. Skips are seven engine
custom-property defaulting/substitution cases, two registered-transform cases
and five animation-name parser cases. Registration fixtures manually populate
records; they do not prove document/API registration or end-to-end substitution.

The same command with `test/stylelet/unit/host.test.ts` as the filter passed
another **24 tests** covering connected inline-provider/computed-style reads
and host execution. Combined: **11 files, 1,246 passed tests**, with the same
expected failures and skips. Full cascade/defaulting and live queries remain missing.

### Properties and conditions

**9 files, 958 tests passed**, with no skips or expected failures.

```text
node scripts/with-node.mjs vitest run --project=unit test/stylelet/unit/property.test.ts test/stylelet/unit/values/supports-condition.test.ts test/stylelet/unit/values/color.test.ts test/stylelet/unit/values/gradient.test.ts test/stylelet/unit/values/image.test.ts test/stylelet/unit/values/media-query.test.ts test/stylelet/unit/values/position.test.ts test/stylelet/unit/values/mix.test.ts test/stylelet/unit/values/boolean-expr.test.ts
```

This covers installed definitions, value operations and condition grammar.
It does not establish resource/font delivery, device matching or layout integration.
