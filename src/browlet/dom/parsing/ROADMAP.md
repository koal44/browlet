# DOM parsing and serialization roadmap

HTML §8.5 exposes DOM-facing parsing and serialization APIs while delegating
actual HTML tokenization/tree construction to `html/parser/`. XML syntax needs
a separate parser capability; neither path belongs in generic Node mutation
algorithms.

| Planned source or owner | Contract | Specification |
| --- | --- | --- |
| `dom-parser.ts` | `DOMParser`, MIME dispatch, HTML Document creation, XML parse errors, and parser-created settings | HTML §8.5.1 |
| `markup.ts` | Element/ShadowRoot HTML parsing and serialization methods, including `innerHTML`, `outerHTML`, `insertAdjacentHTML()`, `getHTML()`, and safe/unsafe setters | HTML §§8.5.2–8.5.6 |
| `html-serializer.ts` | The shared HTML fragment serialization algorithm consumed by markup APIs | HTML §13, "Serializing HTML fragments" |
| `xml-parser.ts` | XML document and fragment parsing adapter over a conforming XML syntax engine | HTML §14; XML 1.0; Namespaces in XML |
| `xml-serializer.ts` | `XMLSerializer` over namespace-aware DOM trees | HTML §8.5.8; DOM Parsing and Serialization |
| `web-idl.ts` | DOMParser/XMLSerializer interfaces and Element, ShadowRoot, and Range contributions | HTML §8.5 |

`html/parser/fragment.ts` owns the HTML fragment algorithm. `Range` owns
`createContextualFragment()` but consumes that same fragment parser. Safe HTML
setters additionally consume `html/sanitization/`; unsafe setters must remain a
distinct contract rather than silently sanitizing.

Blink's `DOMParser` lives with XML/DOM parsing rather than its HTML document
parser, while its sanitizer has a separate core domain. That split supports
these owners without requiring Browlet to mirror Blink's file granularity.

## XML syntax-engine qualification

HTML §14 is short because it delegates XML syntax and namespace well-formedness
to the XML specifications; it explicitly notes that no complete standard
algorithm maps XML input to a DOM. It is therefore not a small parser waiting
to be transcribed.

Do not select an XML engine merely because jsdom uses it. Saxes has the right
evented shape, namespace tracking, and fragment support, but it is a
pure-JavaScript fork of `sax-js`, not a binding to libxml2 or Expat. Its
repository is now archived, and it deliberately does not implement the
internal-DTD declarations and entities required of an XML 1.0 non-validating
processor.

`@federicocarboni/saxe` is the leading replacement candidate. It targets XML
1.0 and Namespaces in XML 1.0, parses the internal DTD subset, imposes
configurable resource limits, and is fuzz-tested. HTML §14 does not require
XML 1.1. Its lack of a special fragment mode is not by itself a gap: HTML's
specified fragment algorithm feeds a synthetic context start tag, the input,
and the matching end tag to one parser. Browlet must qualify that streaming
path rather than depend on a parser-specific fragment shortcut.

Before adding either dependency, run a Browlet-owned qualification suite that
covers:

- applicable W3C XML and Namespaces conformance cases, including internal
  entities, defaulted attributes, malformed DTD declarations, and duplicate
  expanded attribute names;
- equivalent results for whole-string and spoon-fed/chunked input;
- HTML §14 fragment wrappers with inherited default and prefixed namespaces,
  plus realm-correct `SyntaxError` failures;
- bounded entity expansion, nesting, text, names, and attributes, with no
  arbitrary external-entity fetches; and
- browser and supported-Node builds without native parser dependencies.

Blink delegates XML syntax to libxml2 (with a newer Rust-backed path), while
Gecko delegates it to Expat. Those native dependencies are useful
implementation evidence but would compromise Browlet's portable TypeScript
package boundary. Whichever JavaScript engine passes the qualification suite,
Browlet must still own the DOM adapter and HTML integration:

- namespace-aware Element, Attr, CDATASection, ProcessingInstruction, comment,
  text, and doctype creation;
- DOM insertion, attribute, mutation-observer, custom-element, open-element,
  and template-content behavior;
- optional XML scripting support, parser blocking, and the shared stop/abort
  parsing lifecycle;
- the tightly restricted external-entity policy from HTML §14, without
  allowing arbitrary network entity loads; and
- fragment parsing with the context's in-scope namespaces and a `SyntaxError`
  DOMException for XML or namespace well-formedness failures.

Implement the character-input `DOMParser` and XML-fragment path first, after
CDATASection, ProcessingInstruction, and complete DOM insertion hooks exist.
XML navigation is a later loader slice because it additionally needs XML byte
encoding, response handling, script blocking, and document completion. Make
the qualified syntax engine a direct Browlet dependency only when that first
implementation lands; a transitive parser used by test tooling is not a
package contract.

## Removal condition

Burn this file once the public parsing/serialization APIs share the HTML
fragment parser and serializers, XML has an explicitly qualified syntax-engine
capability, and safe setters use the sanitizer rather than ad hoc filtering.
