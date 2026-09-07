# DOM XPath roadmap

## Standards boundary

DOM §8 preserves the Web IDL surfaces for the widely implemented DOM Level 3
XPath API, but explicitly says that their complete definitions are missing.
The interface declarations alone are therefore not an implementable normative
algorithm. Conformance work must combine:

- the current DOM §8 Web IDL;
- XPath 1.0 and the historical DOM Level 3 XPath contract;
- HTML §2.1.11's required default-element-namespace change for HTML Documents;
- Web Platform Tests and browser behavior where the old specifications leave
  observable gaps.

Do not fill those gaps silently from one engine. Record each interoperability
decision or limitation beside its behavioral test.

## Planned surface

| Planned source | Contract | Specification |
| --- | --- | --- |
| `engine.ts` | Narrow compile/evaluate adapter over a qualified XPath 1.0 engine and Browlet nodes | XPath 1.0; DOM Level 3 XPath |
| `expression.ts` | `XPathExpression`, compiled-expression state, context validation, and evaluation | DOM §8, `#interface-xpathexpression` |
| `result.ts` | `XPathResult`, scalar/node result types, iteration, snapshots, optional result reuse, type errors, and iterator invalidation | DOM §8, `#interface-xpathresult` |
| `evaluator.ts` | `XPathEvaluator`, `XPathEvaluatorBase`, Document contribution, expression creation/evaluation, and legacy `createNSResolver()` identity behavior | DOM §8, `#mixin-xpathevaluatorbase` and `#interface-xpathevaluator` |
| `web-idl.ts` | `XPathNSResolver` callback interface and all public interface/mixin definitions | DOM §8 |

## Engine qualification

Blink carries an in-tree XPath lexer/parser/evaluator; Gecko shares its XPath
engine with its transformation subsystem. jsdom embeds an old JavaScript XPath
implementation which itself says it should be replaced and currently omits
important iterator-invalidation behavior. Those are useful test sources, not a
reason to copy an unmaintained evaluator into Browlet.

Before selecting an implementation or deciding to write one, qualify it for:

- all XPath 1.0 axes, predicates, node tests, conversions, functions, document
  order, and namespace resolution against Browlet's namespace-aware nodes;
- HTML's default XHTML element namespace for unprefixed element tests, without
  applying that default to attributes or XML Documents;
- JavaScript function/object `XPathNSResolver` callbacks with Web IDL callback
  realm and exception behavior;
- every `XPathResult` requested type, wrong-type access, result reuse,
  snapshots, single-node results, and mutation invalidation of iterator
  results; and
- deterministic resource behavior: XPath evaluation itself must not gain
  filesystem or network access from an engine adapter.

The DOM mutation spine must expose enough document mutation state to invalidate
live iterator results. XPath-specific parsing and values remain behind
`engine.ts`; the public adapter must not leak an engine's AST or node wrappers.

## Delivery position

XPath is not part of the initial browsing lifecycle. Implement it after
namespace-aware DOM nodes, complete mutation tracking, XML parsing, Web IDL
callbacks, and DOMException behavior are stable. It can precede XSLT and can
serve as evidence for a shared internal expression engine, but XSLT must not
depend on the public `XPathResult` API.

## Removal condition

Burn this file once a qualified engine and the complete public surfaces pass
behavioral tests for HTML and XML Documents, including mutation invalidation.
