# Browlet style integration

This subsystem connects Browlet's documents and elements to Stylelet. Stylelet
owns CSS interpretation and mutation; Browlet owns DOM notifications, policy,
document association, and browser execution. The
[roadmap](ROADMAP.md) records missing host dependencies and retained browser
conflicts. Stylelet's [CSSOM inventory](../../stylelet/cssom/README.md) describes
the implementation objects currently being exposed.

## Owners and entry points

- Document lazily creates its Stylelet engine and exposes the document
  `TreeScope`. `DocumentOrShadowRootMixin` forwards stylesheet access through
  its root. ShadowRoot's `getStyleScope()` is still an explicit unimplemented
  dependency, despite the shared IDL contribution.
- [integration.ts](integration.ts) implements the permanent
  `ElementCSSInlineStyleMixin` owned by HTML, SVG, and MathML elements, and the
  `LinkStyleMixin` for current inline-sheet associations. Includers explicitly
  forward their members and notifications. Generic Element supplies an empty
  internal inline-data query but does not include ElementCSSInlineStyle.
- [DOM operations](../integration/dom.ts) let Stylelet query Browlet
  implementations without Platform conversion or structural node wrappers.
- [Stylelet's declarations](../../stylelet/web-idl.ts) supply common CSSOM
  interfaces and mixin/partial contributions, including sheet construction and
  CSSStyleProperties accessors. Browlet's environment supplies
  `getAssociatedDocument()` for the constructor. The pending Core hook boundary
  is recorded in the [CSSOM roadmap](../../stylelet/cssom/ROADMAP.md#declaration-hook-boundary).
  Adoption still awaits its §6.2 binding.
- Window's CSSOM partial projects `getComputedStyle()` results and converts its
  arguments. The algorithm still returns a limited snapshot; complete computed
  values and liveness remain unfinished.

## Inline-style lifecycle

Each HTML/SVG/MathML element has its mixin from construction. The current mixin
retains an optional `CSSDeclarationBlock` and an optional
`CSSStylePropertiesImpl`. Construction allocates neither and reads no attribute.

| Input or query | Current behavior |
| --- | --- |
| Add/change the null-namespace `style` attribute | Check the current node document's CSP, then parse accepted text into retained declaration data. This also handles parser input and assignments before the first `.style` read. |
| CSP rejects attribute input | Preserve the raw DOM attribute and the previous accepted declaration data under the approved browser choice. An initially blocked attribute supplies no declarations. |
| Read `.style` | Lazily create and retain the CSSOM implementation around the existing data, or an empty block. Do not reread the attribute or check CSP again. |
| Mutate through CSSOM | Update declarations, serialize to the attribute, and suppress recursive attribute input while the declaration's updating flag is set. CSSOM writes bypass the attribute CSP gate. |
| Remove the attribute | Clear retained declarations without checking CSP or allocating missing state. |
| Cascade reads inline data | Return the existing block or null without creating inline CSSOM. A null provider result is authoritative; it must not trigger parsing of blocked raw text. |

The policy operation is
[`CSPList.isStyleAttributeBlocked()`](../browsing/policy/csp/list.ts). It
authorizes raw inline source and reports policy violations; it does not parse
CSS or selectively allow property names. Hash matching precedes CSS parsing
because source spelling matters. Policy is read from the current node document,
including after adoption. See the [CSP evidence](../browsing/policy/csp/ROADMAP.md#style-attribute-consumer).

Binding reads numeric properties from the current declaration list, so attribute
input needs no index synchronization. The declaration-data ownership remains
under review. The mixin never stores computed style; engine queries currently
produce a separate snapshot object.

## Sheet association and execution

`LinkStyleMixin` currently associates HTML and SVG inline style elements with
the document tree scope. Parser-created elements defer association until their
text is complete. Text/tree/type changes update association; media/title changes
can update an existing sheet. TreeScope maintains document order, sheet-set
selection, and adopted sheets. External links, XML processing instructions, HTTP
Link input, and complete resource blocking/loading are not supplied by these
helpers.

Documents and CSSOM implementations use their existing environment through
`StyleletEnvironment`. UserAgent provides DOM operations, URL construction, and
decoding. `env.exec` supplies promises, background work, and owner task delivery.
There is no separate document execution adapter. Sheet and declaration failures
use DOMException implementations and Binding realization. The adopted-sheet
collection still constructs host exceptions until its §6.2 binding is completed.

The distinction between inline declaration data, inline CSSOM, and computed
results is real. Their present class/container arrangement is a working trial.
Existing storage-identity and allocation tests describe that trial; they do not
require the declaration audit to preserve it.

## Verification

[Style tests](../../../test/browlet/style/) cover inline state, sheet association,
ordering, adopted sheets, environment integration, and selected author calls.
[CSP style tests](../../../test/browlet/browsing/policy/csp/style-attribute.test.ts)
cover raw-source policy, reporting, blocked replacements, parsing, and adoption.
These suites passed in the 2026-10-19
[CSSOM baseline](../../stylelet/cssom/README.md#validation-baseline).

Full CSSOM Platform conformance, live computed results, shadow-root styles,
external sheets, and rendering remain outside that passing baseline. Keep those
dependencies visible in the roadmap as implementation proceeds.
