# Stylelet roadmap

The [README](README.md) describes current implementations and test evidence.
This roadmap maps outstanding CSS work to its owners;
[project priority](../PRIORITY.md#stylelet-delivery-order) orders delivery.

## Review starting point

Audit CSSStyleDeclaration/CSSStyleProperties and ElementCSSInlineStyle together:
declaration state, attribute input, CSSOM mutation, engine reads and the typed
Platform boundary. The [CSSOM review order](cssom/ROADMAP.md#next-review-order)
then follows those declarations into rules, sheets and style queries. Missing
resource/layout consumers remain explicit at their owners.

## Missing contracts

| Missing or incomplete contract | Owning work and stopping point |
| --- | --- |
| CSSOM Platform interfaces | Stylelet supplies implementations and neutral IDL; the active host binds them. Complete typed results, identity, receivers, conversion, indexed exposure, promises, and exception realms. See [CSSOM projection](cssom/ROADMAP.md#projection-and-declaration-lifecycle). |
| Declaration/rule mutation ownership | Review the current declaration block, CSSOM object, and interpreted-rule copy-back together. Preserve observable mutation behavior without treating current storage tests as architecture requirements. |
| Stylesheet rule participation | The interpreter drops at-rules; nested style rules are retained but not visited by the cascade. Namespace context, declaration runs, group conditions, layers, imports, and scope need connected representations/consumers. See the [rule roadmap](css/ROADMAP.md). |
| Selector context and support | Parsing covers more than runtime matching. Preserve namespace/nesting context, stylesheet tree scope, pseudo-element subjects, and dynamic host facts; review overlap with Selectlet through existing DOMOperations. See the [selector roadmap](selector/ROADMAP.md). |
| Full computed and resolved values | The [engine roadmap](engine/ROADMAP.md) owns complete selection/defaulting/inheritance; the [lifecycle roadmap](value-processing/ROADMAP.md) records property metadata and stage inputs. Connectedness, flat-tree/pseudo-element identity, and rendering facts come from their owners. Live views and caches require explicit freshness/invalidation contracts. |
| Substitution and registration | The [value roadmap](values/ROADMAP.md) records variable replacement, cycles, fallback, typed registered values, and provenance. Registration lookup and direct value tests exist; document/API registration and per-element computation are not connected. |
| Resource/base-URL provenance | Preserve declaration parse-time bases before enabling URL-valued properties. Sheet fetching, response policy, MIME/encoding, origin-clean state, imports, and load completion cross into [Browlet's loader](../browlet/loader/ROADMAP.md) and [style integration](../browlet/style/ROADMAP.md). |
| Sheet applicability and scopes | `TreeScope` already orders sheets, but media matching, shadow-root scopes, and complete mutation invalidation remain incomplete. The [condition roadmap](conditional/ROADMAP.md) separates support, media, and container evaluation and their different reference styles. |
| Property families and contextual facts | The [family roadmap](props/ROADMAP.md) groups missing definitions; [value inputs](values/ROADMAP.md#context-inputs-and-freshness) identify existing fields, missing delivery, and update triggers. Parser breadth is not property support. |
| Typed OM and descriptor interfaces | [Typed OM](cssom/typed/ROADMAP.md) owns public values/maps, reification, shared declaration views, and live computed maps. Descriptor interfaces retain their family-specific inventories. |
| Resource and effect state | [Fonts](../fonts/ROADMAP.md), [graphics](../graphics/ROADMAP.md), and [animation](../animation/ROADMAP.md) own shared resource/effect behavior; host loading, policy, and scheduling remain explicit integration dependencies. |
| Geometry and measured APIs | [Geometry](../geometry/ROADMAP.md) owns geometric objects; [layout](../layout/ROADMAP.md) owns measured results. [Browlet rendering](../browlet/rendering/ROADMAP.md#measured-dom-apis) connects CSSOM View and observations without inferring boxes from style alone. |

## Decisions still open

- Final declaration-state ownership: the separate `CSSDeclarationBlock` is a
  working trial, not a constraint on `CSSStylePropertiesImpl`.
- Rule identity and storage across interpretation, CSSOM mutation, nesting,
  replacement, and engine reads.
- The standalone author's CSSOM binding surface versus direct, post-conversion
  implementation APIs. Keep host-specific Platform objects out of Stylelet.
- Live computed-style queries and any engine-owned cached value state. Neither
  inline style nor a CSSOM result should become an accidental owner of layout.
- The broad `css/` folder name and stylesheet matcher sharing with Selectlet.
  Settle the state/consumer boundaries before renaming or merging these owners.

## Source organization

Keep responsibility-based folders: a specification can contribute syntax,
values, retained state, CSSOM interfaces, and engine behavior. Shared value
algorithms stay in `values/`; property definitions stay in `props/`, with family
subfolders when useful. Descriptors belong to the feature that owns them.

| Owner | Planned responsibility and boundary |
| --- | --- |
| [CSSOM Typed OM](cssom/typed/ROADMAP.md) | Typed interface implementations and declarations; reuse value arithmetic and the ordinary CSSOM declaration owner |
| [Geometry](../geometry/ROADMAP.md) | Geometric objects and arithmetic; CSS-string matrix parsing needs a specific Stylelet connection |
| [Fonts](../fonts/ROADMAP.md) | Shared faces, loading state, selection, metrics, and shaping; CSS grammar stays here and document readiness is integrated by Browlet |
| [Graphics](../graphics/ROADMAP.md) | Shared image/pixel data and graphics operations; host source extraction, request policy, and presentation have separate consumers |
| [Animation](../animation/ROADMAP.md) | Timing, playback, and effects; Stylelet supplies property operations and CSS producers, Browlet supplies scheduled updates |
| [Layout](../layout/ROADMAP.md) | Boxes, formatting, fragments, and retained results; consumes internal style and explicit font/image/tree inputs |
| [Browlet style](../browlet/style/ROADMAP.md), [rendering](../browlet/rendering/ROADMAP.md) | DOM associations, media notifications, pseudo/highlight identity, measured APIs, HTML update ordering, and presentation |
| [Browlet worklets](../browlet/worklets/ROADMAP.md#css-worklet-consumers) | Module/global lifetime; concrete graphics/layout/animation consumers own their input and output contracts |

The new subsystem folders contain roadmaps only. They establish owners, not
runtime APIs or a complete portability layer. Direct lower-level dependencies
are allowed; use existing environments for execution/allocation and narrow
capabilities for reverse or host-specific dependencies. See
[project architecture](../ARCHITECTURE.md#choosing-a-dependency).

## Sources and reading depth

Prefer local sources under `C:/Users/rando/source/repos/_web-platform/specs/`:
`csswg-drafts`, `css-houdini-drafts`, and the sibling WHATWG checkouts. Most CSS
modules use `Overview.bs`; Style Attributes uses `Overview.src.html`.

The 2026-10-19 reference review covered CSSOM/embedding, syntax/selector/rule
boundaries, cascade/value stages, and representative property/API dependencies.
It was not a complete property or rendering audit. Checkout revisions were not
established; local reading does not prove agreement with every live draft.
Current implementations and dated test evidence belong in READMEs.

[CSS Snapshot 2026](https://drafts.csswg.org/css-2026/#module-classification) and
[CSS Current Work](https://www.w3.org/Style/CSS/current-work) provide breadth/status
indexes, not implementation order. CSS2 retains requirements not replaced by
modules. Read base specifications with additions: Cascade 6, Values 5,
Selectors 5, and Conditional 5 do not replace all earlier-level text.
Follow incoming CSSOM extensions as well as its bibliography.

## Specification families

Local module names below retain the broad requirements without creating one
folder per specification. Property syntax/computation remains relevant when
visual realization belongs to a separate engine.

| Family and source modules | Owning work / dependency |
| --- | --- |
| Syntax/embedding: `css-syntax-3`, `css-style-attr-1`, remaining CSS2 syntax | Syntax, rules, CSSOM entry points; Encoding, URL provenance, DOM lifecycle, CSP |
| Selection/scopes: `selectors-4/5`, `css-namespaces-3`, `css-nesting-1`, `css-shadow-1` | Selectors/rules/engine; DOM state and flat/shadow trees. Shadow 1 combines former Scoping/Shadow Parts modules. |
| Cascade/substitution: `css-cascade-5/6`, `css-variables-1/2`, `css-env-1` | Engine, lifecycle, values; UA/user sources and environment values |
| Shared/newer values: `css-values-4/5`, `css-conditional-values-1`, `css-mixins-1` | Values, staged evaluation, and new rule forms; audit proposals against base levels |
| Conditions: `css-conditional-3/4/5`, `mediaqueries-4/5`, `css-contain-1/2/3/4` | Conditions and applicability; device preferences, container eligibility, layout snapshots. Container queries are in Conditional 5. |
| Color: `css-color-4/5/6`, `css-color-adjust-1`, `css-color-hdr-1` | Values/properties; system palettes, profiles, output capabilities |
| Images/backgrounds: `css-images-3/4/5`, `css-backgrounds-3/4`, `css-borders-4`, `css-image-animation-1` | Values/properties; graphics resources, intrinsic dimensions, frames, painting |
| Fonts/text: `css-fonts-3/4/5`, `css-font-loading-3`, `css-text-3/4/5`, `css-text-decor-3/4`, `css-writing-modes-3/4`, `css-ruby-1` | CSS definitions; font resources/matching, shaping, layout, decoration output |
| Boxes/positioning: `css-box-3/4`, `css-display-3/4`, `css-sizing-3/4`, `css-size-adjust-1`, `css-position-3/4`, `css-anchor-position-1/2`, `css-align-3`, `css-gaps-1`, `css-logical-1` | Property computation and layout; Alignment delegates gaps to Gaps 1 |
| Formatting: `css-flexbox-1/2`, `css-grid-1/2/3`, `css-tables-3`, `css-multicol-1/2`, `css-inline-3`, `css-break-3/4`, `css-overflow-3/4/5`, `css-exclusions-1`, `css-shapes-1/2`, `css-floats-3` | Property/shape values; formatting contexts, tracks, fragments, overflow |
| Generated/paged content: `css-content-3`, `css-lists-3`, `css-counter-styles-3`, `css-page-3/4`, `css-gcpm-3/4`, `css-page-floats-3` | Rules/descriptors and scoped state; generated boxes, counters, pagination/print |
| Effects: `css-transforms-1/2`, `motion-1`, `filter-effects-1/2`, `css-masking-1`, `compositing-1/2`, `fill-stroke-3` | Values/interpolation; geometry, SVG resources, graphics/compositing |
| Pseudo-elements/highlights: `css-pseudo-4`, `css-highlight-api-1` | Style subjects; DOM ranges/identity and fragment painting |
| Animation: `css-easing-1/2`, `css-animations-1/2`, `css-transitions-1/2`, `web-animations-1/2`, `scroll-animations-1`, `css-view-transitions-1/2`, `animation-triggers-1`, `pointer-animations-1` | CSS producers/property combination; animation state and host time/scroll/capture delivery |
| UI/scrolling: `css-ui-3/4`, `css-forms-1`, `css-viewport-1`, `css-scroll-snap-1/2`, `css-scroll-anchoring-1`, `css-scrollbars-1`, `css-overscroll-1`, `css-will-change-1`, `css-navigation-1`, `css-spatial-nav-1` | Properties/queries; interaction, widgets, focus/navigation, viewport state. Review navigation drafts before selecting a target. |
| Geometry/observation: `cssom-view-1`, `geometry-1`, `resize-observer-1` | Geometry objects, layout results, host APIs and ordered observation delivery |
| Speech: `css-speech-1` | Properties if included in the supported profile; speech/accessibility output is separate |

Houdini [Typed OM](cssom/typed/ROADMAP.md) and
[Properties and Values API](values/ROADMAP.md#registered-values-and-provenance)
have concrete owners. Painting, Layout, and Animation Worklets require their
actual consumer and HTML lifetime support. Font Metrics, Box Tree, CSS Parser API
(redirecting to WICG), Scroll Customization, and historical Regions/Shader/page
template proposals need a current-source and relevance check before adding work.

Fetch/URL/Encoding/MIME/HTTP, DOM/HTML/SVG/MathML, Web IDL, and browser policy
retain their existing owners. Stylesheet association includes XML processing
instructions and HTTP metadata as well as HTML elements. Keep each missing
consumer in its owning roadmap instead of another parallel dependency inventory.
