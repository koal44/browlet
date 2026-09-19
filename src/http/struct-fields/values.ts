/*
 * RFC 9651 §3, Structured Data Types.
 *
 * These records retain type distinctions that JavaScript primitives alone
 * would lose. Dictionaries and parameters expose insertion order through Map.
 * https://www.rfc-editor.org/rfc/rfc9651.html#section-3
 */
export type StructuredField = StructuredList | StructuredDictionary | StructuredItem;

export type StructuredList = {
  type: 'list';
  members: (StructuredItem | StructuredInnerList)[];
};

export type StructuredDictionary = {
  type: 'dictionary';
  members: Map<string, StructuredItem | StructuredInnerList>;
};

export type StructuredItem = {
  type: 'item';
  bareItem: StructuredBareItem;
  parameters: StructuredParameters;
};

export type StructuredInnerList = {
  type: 'inner-list';
  items: StructuredItem[];
  parameters: StructuredParameters;
};

export type StructuredParameters = Map<string, StructuredBareItem>;

/*
 * Integer and Date limits fit exactly in a JavaScript number. Dates retain
 * epoch seconds, without the narrower range or millisecond units of JS Date.
 * Decimal serialization interprets a number's shortest decimal spelling and
 * applies RFC 9651 §4.1.5 rounding. Other invalid values fail serialization.
 */
export type StructuredBareItem =
  | { type: 'integer'; value: number; }
  | { type: 'decimal'; value: number; }
  | { type: 'string'; value: string; }
  | { type: 'token'; value: string; }
  | { type: 'bytes'; value: Uint8Array; }
  | { type: 'boolean'; value: boolean; }
  | { type: 'date'; value: number; }
  | { type: 'display-string'; value: string; };
