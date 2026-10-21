import { InternalError } from '../../infra/internal-error';

/** Placeholder for the CSS Typed OM property map exposed by CSSStyleRule.styleMap. */
// https://drafts.css-houdini.org/css-typed-om-1/#the-stylepropertymap
export class StylePropertyMapImpl {
  /** Fail explicitly until typed values and declaration-map operations are implemented. */
  constructor() {
    // TODO: Implement CSS Typed OM values and property-map operations together.
    throw new InternalError('StylePropertyMap is not implemented');
  }
}

// TODO: Bind these Typed OM interfaces and the rule partial with their implementations.
// CSSStyleValue conversion/reification and the read-only map base are still missing.
// https://drafts.css-houdini.org/css-typed-om-1/#the-stylepropertymap
// https://drafts.css-houdini.org/css-typed-om-1/#declared-stylepropertymap-objects
/*
 * [Exposed=(Window, Worker, PaintWorklet, LayoutWorklet)]
 * interface StylePropertyMapReadOnly {
 *   iterable<USVString, sequence<CSSStyleValue>>;
 *   (undefined or CSSStyleValue) get(USVString property);
 *   sequence<CSSStyleValue> getAll(USVString property);
 *   boolean has(USVString property);
 *   readonly attribute unsigned long size;
 * };
 *
 * [Exposed=Window]
 * interface StylePropertyMap : StylePropertyMapReadOnly {
 *   undefined set(USVString property, (CSSStyleValue or USVString)... values);
 *   undefined append(USVString property, (CSSStyleValue or USVString)... values);
 *   undefined delete(USVString property);
 *   undefined clear();
 * };
 *
 * partial interface CSSStyleRule {
 *   [SameObject] readonly attribute StylePropertyMap styleMap;
 * };
 */
