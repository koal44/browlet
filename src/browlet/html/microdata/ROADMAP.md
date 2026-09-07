# Microdata roadmap

Current HTML §5 defines Microdata as content-attribute semantics and extraction
algorithms. It does not define the former `Document.getItems()`,
`HTMLPropertiesCollection`, or `PropertyNodeList` Web IDL surfaces. Do not
reintroduce those obsolete interfaces or add a Microdata `web-idl.ts`.

## Planned ownership

| Planned source or owner | Contract | Specification |
| --- | --- | --- |
| `html/global-attributes.ts` | Recognition and mutation hooks for `itemscope`, `itemtype`, `itemid`, `itemprop`, and `itemref`, without inventing an author-facing IDL reflection surface | HTML §§5.2.2–5.2.3 |
| `model.ts` | Derived item types, global identifier, property names, typed/top-level-item predicates, and element-specific property values | HTML §§5.2.2–5.2.4 |
| `properties.ts` | `itemref` traversal, cycle/error detection, deduplication, and tree-ordered property discovery | HTML §5.2.5 |
| `json.ts` | Extract Microdata from a node list and recursively obtain the JSON object for an item | HTML §5.4.1 |
| Deferred serializer adapters | vCard and vEvent conversion algorithms if Browlet later exposes a concrete consumer | HTML §§5.3.1–5.3.2 |

Licensing works in §5.3.3 defines a sample vocabulary rather than a browser
runtime object. It needs conformance examples, not a Browlet class.

Property values deliberately reuse element behavior: metadata content, URL
parsing against the node document for URL-property elements, `data`/`meter`
values, `time` datetime state, nested items, or descendant text. The Microdata
model must call those owners rather than duplicate their reflection and URL
algorithms.

Microdata is not a prerequisite for document lifecycle, scripting, nested
browsing, or style. Implement it after global attributes and the relevant
element value contracts are stable; its tree traversal then becomes a compact
consumer proving that those layers compose correctly.

## Removal condition

Burn this file once item/property discovery and JSON extraction are implemented
and any supported vocabulary serializers have a narrower owner.
