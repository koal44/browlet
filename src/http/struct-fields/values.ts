/*
 * RFC 9651 §3, Structured Data Types.
 *
 * These records retain type distinctions that JavaScript primitives alone
 * would lose. Dictionaries and parameters expose insertion order through Map.
 * https://www.rfc-editor.org/rfc/rfc9651.html#section-3
 */
export type StructuredField = StructuredList | StructuredDictionary | StructuredItem;

export type StructuredList = {
  readonly type: 'list';
  readonly members: (StructuredItem | StructuredInnerList)[];
};

export type StructuredDictionary = {
  readonly type: 'dictionary';
  readonly members: Map<string, StructuredItem | StructuredInnerList>;
};

export type StructuredItem = {
  readonly type: 'item';
  readonly value: StructuredBareItem;
  readonly parameters: StructuredParameters;
};

export type StructuredInnerList = {
  readonly type: 'inner-list';
  readonly items: StructuredItem[];
  readonly parameters: StructuredParameters;
};

export type StructuredParameters = Map<string, StructuredBareItem>;

/*
 * Integer and Date limits fit exactly in a JavaScript number. Dates retain
 * epoch seconds, without the narrower range or millisecond units of JS Date.
 * Decimal serialization interprets a number's shortest decimal spelling and
 * applies RFC 9651 §4.1.5 rounding. Other invalid values fail serialization.
 */
export type StructuredBareItem =
  | { readonly type: 'integer'; readonly value: number; }
  | { readonly type: 'decimal'; readonly value: number; }
  | { readonly type: 'string'; readonly value: string; }
  | { readonly type: 'token'; readonly value: string; }
  | { readonly type: 'bytes'; readonly value: Uint8Array; }
  | { readonly type: 'boolean'; readonly value: boolean; }
  | { readonly type: 'date'; readonly value: number; }
  | { readonly type: 'display-string'; readonly value: string; };
