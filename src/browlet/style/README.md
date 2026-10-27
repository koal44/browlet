# Browlet style integration

This subsystem connects Browlet's documents and elements to Stylelet. Stylelet
owns CSS interpretation and mutation; Browlet owns DOM notifications, policy,
document association, and browser execution. The
[roadmap](ROADMAP.md) records missing host dependencies and retained browser
conflicts. Stylelet's [CSSOM inventory](../../stylelet/cssom/README.md) describes
the implementation objects currently being exposed.

## Owners and entry points

- Document lazily retains its `TreeScope` and matching context independently
  of its Stylelet engine. The engine uses that scope when first needed.
  `DocumentOrShadowRootMixin` forwards stylesheet access through its root.
  Each ShadowRoot lazily retains its own collections, using the current node
  document's context; adoption updates that context without replacing the scope.
  Collection ownership does not yet select shadow sheets for computed-style matching.
- [inline-style.ts](inline-style.ts) implements the permanent
  `ElementCSSInlineStyleMixin` owned by HTML, SVG, and MathML elements;
  [link-style.ts](link-style.ts) owns `LinkStyleMixin` for current inline-sheet
  associations. Includers explicitly forward their members and notifications.
  Generic Element supplies an empty
  internal inline-data query but does not include ElementCSSInlineStyle.
- [DOM operations](../integration/dom.ts) let Stylelet query Browlet
  implementations without Platform conversion or structural node wrappers.
- [Stylelet's declarations](../../stylelet/web-idl.ts) supply common CSSOM
  interfaces and mixin/partial contributions, including sheet construction and
  CSSStyleProperties accessors. Browlet's environment supplies
  `getAssociatedDocument()` for the constructor. `adoptedStyleSheets` declares
  `ObservableArray<CSSStyleSheet>` and its indexed mutation check; Binding owns
  conversion, the retained array, and realm exception realization.
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
their document or shadow-root scope, obtained directly from the owner's current root.
Parser-created elements defer association until their
text is complete. Text/tree/type changes update association; media/title changes
can update an existing sheet. TreeScope maintains document order, sheet-set
selection, and adopted sheets. Document creation applies each `Default-Style`
response field in order before parsing.

[DocumentImpl.fetchCSSStyleSheet()](../dom/nodes/document.ts) uses Fetch for external CSS,
including CSP, nosniff, HTTP-status/MIME checks, response filtering, and complete
body consumption. Accepted bytes use CSS Syntax's decoder with transport,
`@charset`, and environment encoding inputs. The initial URL supplies `href`;
the final response URL supplies the parse base. Cross-origin opaque responses
produce non-origin-clean sheets whose rules cannot be read through CSSOM.

`document.loadStyleSheetImports(sheet, parameters, complete, started?)` explicitly
connects Stylelet's import-tree loading to this fetcher. `parameters(parent)` supplies current
request settings, including the owner's render-blocking flag. Completion reports
whether all required attempts succeeded, after nested imports finish; cancellation
stops pending requests and suppresses late association/completion. Fetched sheets
retain their decoded encoding, including BOM precedence, for child imports. CSSOM
mutations reuse the connection: insertion joins the current attempt or creates a
new one after completion; deletion/replacement withdraw pending branches.
`started(load)` receives each new cancellable attempt before fetching begins.
Cancellation disconnects the current connection, including after completion;
removing an associated sheet invokes cancellation before clearing its associations.
HTML/PI/header owners do not yet start this operation automatically or consume its
notifications for events and blockers.

Import rules retain `UrlValue`, including request modifiers, while `href` remains
the decoded author URL. The import fetch adapter applies those modifiers after
the owner's request parameters through `UrlValue.applyRequestModifiers()`.
Stylelet's [resource fetcher](../../stylelet/resource.ts) owns CSS Values §4.5.4's
base selection, URL resolution, and fetching. Its path is tested separately; imports
still use the CSSOM fetcher's established response policy and failure handling.

[processing-instruction.ts](processing-instruction.ts) owns PI association,
replacement, cancellation, and prolog membership. Document child mutations and
the PI's move hook keep membership current. Moving within the prolog retains and
reorders the sheet; leaving it cancels loading and removes the association.
The existing XML pseudo-attribute parser supplies recognition, including XML
names and character references. DOM setters retain their broader name rules,
but an invalid XML name prevents stylesheet recognition. ProcessingInstruction's
LinkStyle inclusion projects the same implementation owned by this lifecycle.

Document's `processDefaultStyleHeaders()` and `processStyleSheetLinkHeaders()` handle
ordered Default-Style fields and stylesheet Link relations.
`Navigable.createAndInitializeDocument()` calls these methods directly and commits
early hints before pre-media Link processing.
Stylesheet Link handling uses the [HTTP field parser](../../http/link.ts),
retains field/target order across asynchronous completion, and inserts header
sheets before tree sheets. First `title`/`media` values and alternate eligibility
follow CSSOM; anchored links are ignored as RFC 8288 permits. This is separate
from HTML's still-provisional preload/header phases. See the
[remaining resource work and disagreements](ROADMAP.md#external-stylesheet-loading).

Documents and CSSOM implementations use their existing environment through
`StyleletEnvironment`. UserAgent provides DOM operations and the Blob URL store;
Stylelet imports URL parsing and Encoding directly. `StyleletEnvironment` extends
`FetchEnvironment`; Browlet supplies its existing Fetch state and execution.
The stylesheet loader reads the supplied `DocumentImpl`'s URL, origin, policy container,
live encoding, and quirks mode directly and uses `document.env`.
`env` supplies promises, background work, and owner task delivery.
There is no separate document execution adapter. Sheet, declaration, and adoption
failures use DOMException implementations and Binding realization.

TreeScope's adopted list is ordinary implementation state. Internal list changes
are visible through the retained Platform array; author writes first convert
and run the declared adoption check. Moving a shadow host to another document
clears that list in place and switches its engine. The
[adoption gap](ROADMAP.md#stylesheet-collection-disagreements) records the browser evidence.

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

Full CSSOM Platform conformance, live computed results, shadow-tree cascade selection,
HTML link/import loading, and rendering remain outside that passing baseline. Keep those
dependencies visible in the roadmap as implementation proceeds.
