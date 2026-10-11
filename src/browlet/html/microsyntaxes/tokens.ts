import { surroundingASCIIWhitespacePattern } from '../../../infra/index';

/** Split comma-delimited fields, retaining empty fields, duplicates, case, and internal whitespace. */
// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#comma-separated-tokens
// HTML defines the syntax, not a parsing algorithm. This helper preserves every field,
// including a final empty field and the single empty field in ''. A caller that specifies
// Infra's "split on commas" instead needs that algorithm's different final-empty rule.
export function parseCommaSeparatedTokens(input: string): string[] {
  const tokens = input.split(',');
  for (let i = 0; i < tokens.length; i++) {
    tokens[i] = tokens[i]!.replace(surroundingASCIIWhitespacePattern, '');
  }
  return tokens;
}
