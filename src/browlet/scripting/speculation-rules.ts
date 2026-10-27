import { InternalError } from '../../infra/index';
import type { URLRecord } from '../../url/index';

import type { DocumentImpl } from '../dom/nodes/index';

/** Retains a speculation rule set or its parse error until registration; this is not a Script. */
// https://html.spec.whatwg.org/multipage/webappapis.html#speculation-rules-parse-result
export class SpeculationRulesParseResult {
  speculationRuleSet: SpeculationRuleSet | null = null;
  /** JavaScript exception preventing registration, or null when none was recorded. */
  errorToRethrow: unknown = null;

  /** Parse against the document's current base URL without registering or reporting errors. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#create-a-speculation-rules-parse-result
  constructor(input: string, document: DocumentImpl) {
    try {
      this.speculationRuleSet = SpeculationRuleSet.parse(input, document, document.getBaseURL());
    } catch (error) {
      // An unfinished implementation is not an author parse error.
      if (error instanceof InternalError) throw error;
      this.errorToRethrow = error;
    }
  }
}

/** Rules retained by a Document for speculative loading. */
// https://html.spec.whatwg.org/multipage/speculative-loading.html#speculation-rule-set
export class SpeculationRuleSet {
  // PROVISIONAL: only an empty set is representable until §7.6 supplies the
  // SpeculationRule model, including predicates and No-Vary-Search hints.
  prefetchRules: never[] = [];

  /** Parse speculation rules using the supplied document and base URL. */
  // https://html.spec.whatwg.org/multipage/speculative-loading.html#parse-a-speculation-rule-set-string
  static parse(_input: string, _document: DocumentImpl, _baseURL: URLRecord): SpeculationRuleSet {
    // TODO(HTML §7.6): JSON-to-Infra parsing, rule validation, URL resolution,
    // document predicates, and console warnings.
    throw new InternalError('Speculation rule set parsing is not implemented');
  }
}
