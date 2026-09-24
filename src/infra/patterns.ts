/** One Infra ASCII whitespace character: tab, LF, FF, CR, or space. */
export const asciiWhitespacePattern = /[\t\n\f\r ]/;

/** A nonempty run of Infra ASCII whitespace, for splitting tokens. */
export const asciiWhitespaceRunPattern = /[\t\n\f\r ]+/;

/** Leading and trailing Infra ASCII whitespace, for replacement with an empty string. */
export const surroundingASCIIWhitespacePattern = /^[\t\n\f\r ]+|[\t\n\f\r ]+$/g;

/** Leading and trailing tabs and spaces, excluding other ASCII whitespace. */
export const surroundingTabOrSpacePattern = /^[\t ]+|[\t ]+$/g;

/** Any code unit outside ASCII digits 0 through 9. */
export const nonASCIIDigitPattern = /[^0-9]/;

/** Any non-ASCII UTF-16 code unit, including surrogates. */
export const nonASCIIPattern = /[\u0080-\uffff]/;

/** CRLF, lone CR, or lone LF, consuming CRLF as one line ending. */
export const lineEndingPattern = /\r\n|\r|\n/g;
