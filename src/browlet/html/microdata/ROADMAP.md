# Microdata roadmap

This subsystem supplies item/property discovery, values, and
[§5.4.1 JSON extraction](https://html.spec.whatwg.org/multipage/microdata.html#json).
The browser consumer is [§6.11.5 drag-and-drop](https://html.spec.whatwg.org/multipage/dnd.html#drag-and-drop-processing-model),
which places the extracted JSON in the drag data store as `application/microdata+json`.
Extraction is implemented; its [drag-and-drop integration](../../interaction/ROADMAP.md) remains unimplemented.

HTML no longer defines the former `Document.getItems()`, `HTMLPropertiesCollection`,
or `PropertyNodeList` Web IDL surfaces. Do not reintroduce those obsolete interfaces
or add a Microdata `web-idl.ts`.

## Item and property-name foundation

The first slice covers §5.1's introduction and the attribute-derived parts of
§§5.2.1–5.2.3. [HTMLElementImpl](../../dom/nodes/html/html-element.ts) owns the
instance queries for item identity, own type tokens, global identifiers, and
property names. §5.2.6's namespace boundary is applied at discovery and extraction:
only HTML elements and namespace-less attributes participate.

An item remains its existing element. Item and name queries read current attributes directly.
The [global attribute inventory](../../dom/nodes/html/attributes/global.ts)
already permits all five Microdata attribute names.

Processing follows the specified parsing rules even for nonconforming markup:
item types retain opaque tokens and duplicates, while property names remove
duplicates in first-occurrence order. Vocabulary validity is an authoring
constraint, not a reason to reject tokens or fetch a type URL. A global identifier
is a parsed URL record or null, using the element's current node document,
base URL, and encoding through `Document.encodingParseURL()`.

[Tests](../../../../test/browlet/html/microdata/model.test.ts) cover parsed and
author-mutated attributes, namespace and case boundaries, ASCII tokenization,
invalid markup, document encoding, base changes, and adoption.

## Authoring boundary

[Typed items and relevant types](https://html.spec.whatwg.org/multipage/microdata.html#relevant-types)
govern §5.2.3's property-name authoring requirements. Vocabulary validation and
inherited-type queries are outside this browser-runtime scope. JSON extraction
uses only each item's explicit `itemtype` tokens, read by `getItemTypes()`.

`SPEC_GAP(microdata-shared-type-inheritance)`: the inherited relevant-types definition
uses a singular owner although properties can belong to several items. Revisit
contextual handling only if vocabulary validation is introduced; extraction needs
no combined type list. The [removed Microdata DOM API](https://github.com/whatwg/html/issues/208)
provides no native browser query to resolve that question.

## §5.2.4 Property values

`HTMLElementImpl.getPropertyValue()` returns the existing element for a nested
item, or a string from the specified content attribute, datetime value, or
descendant text. An element without `itemprop` returns null, distinct from a
valid empty-string value. Foreign elements are excluded before calling the
HTML-only queries. Empty property names
do not change the value rule; discovery still uses the separate name list.
Meter values remain literal attribute text, without numeric parsing or clamping.

URL-property elements retain a serialized URL in `HTMLElementImpl` when their
namespace-less `src`, `href`, or `data` attribute is set. The existing DOM attribute
change path covers parser construction, setters, Attr edits, replacement, and
cloning. This must run even before `itemprop` is present. Later base/encoding
changes and adoption preserve the result; setting the attribute again reparses
it. Missing or failed URLs produce the empty string. Cloning/importing sets new
attributes against the copy's node document rather than copying the retained URL.

The small §4.5 `HTMLTimeElementImpl.getDatetimeValue()` dependency reads `datetime`
when present, otherwise direct child text. Date parsing, validity checking, and
the element's public `dateTime` reflection remain Chapter 4 work.
[Value tests](../../../../test/browlet/html/microdata/values.test.ts) cover every
value branch, all eleven URL-property elements, and the attribute lifecycle above.

## §5.2.5 Property discovery

`HTMLElementImpl.getItemProperties()` delegates to its internal
[traversal helper](../../dom/nodes/html/microdata.ts): start from the item's children and its `itemref`
targets, stop descent at nested items, retain HTML elements with property names,
and return them once each in tree order as `HTMLElementImpl[]`. `itemref`
uses the first matching ID in the item's ordinary tree, including a detached
element root. Foreign elements can be traversed or referenced by ID, but their
Microdata attributes have no effect. Shadow trees stay outside the containing
tree. Template contents require the missing parser/element dependency below.

The result is `{ properties, hasError }`. The additional flag exposes the spec's
microdata error when traversal revisits an element, including duplicate reference
tokens and overlapping subtrees. Discovery continues and returns its properties;
no exception or console message is introduced. Non-items return an empty list
and no error. Each call reads the current DOM and returns a fresh snapshot.

`isTopLevelMicrodataItem()` tests item identity and absence of `itemprop`, even
when its value would be empty. DOM ancestry alone does not decide this status.
[Discovery tests](../../../../test/browlet/html/microdata/properties.test.ts) cover
nested items, shared references, ordering, errors, tree/namespace boundaries,
and author mutations.

## §5.4.1 JSON extraction

[json.ts](json.ts) exposes `extractMicrodataJSON(nodes)`, returning compact JSON
with an `items` array. Only supplied top-level items participate; the input list
is not expanded to descendants or deduplicated. Each item contains its explicit
types, serialized global identifier when present, and arrays of property values.

Nested items recurse with a copy of the current ancestor list. A cycle becomes
the string `"ERROR"`; reaching the same item through independent branches is not
a cycle. Discovery errors do not suppress the properties it found. Property-name
dictionaries have no prototype, so `__proto__` and similar names remain data.

[Extraction tests](../../../../test/browlet/html/microdata/json.test.ts) cover
node selection, ordering, identifiers, nested/shared/cyclic items, property-name
collisions, compact escaping, and extraction after author mutations.

## Remaining dependencies and ownership

The traversal's error flag does not validate the complete item graph. §5.2.5's
authoring requirements also forbid cycles between item-valued properties and
orphan `itemprop` attributes; document-wide conformance checking is outside scope.
A cycle between nested item values need not revisit an element within a single
discovery. Recursive JSON extraction has its own memory and `"ERROR"` rule for
those cycles.

The parsed-template regression is an expected failure at the parser's unimplemented
`setTemplateContent()`, before property discovery runs. Template contents must
live in a separate fragment and stay outside both discovery and `itemref`
lookup. Keep this integration requirement visible until Chapter 4 supplies
the template contents/owner document and the
[parser hooks](../parser/ROADMAP.md#first-closure-slice).

| Planned source or owner | Contract | Specification |
| --- | --- | --- |
| `interaction/drag-drop/` | Populate the drag data store with extracted `application/microdata+json` | HTML §6.11.5 |

§5.3's sample vocabularies and vCard/iCalendar conversions have no current browser
consumer and are outside this implementation's scope. The drag-and-drop caller
of §5.4.1's extractor belongs to Chapter 6.
Microdata remains independent of document loading, script execution, and rendering.

## Removal condition

Burn this file once template and drag-and-drop integration are complete.
