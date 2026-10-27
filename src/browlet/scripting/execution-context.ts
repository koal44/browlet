import type { JSFunction } from '../../js-engine/index';

import type { BrowletRealm } from './realm';

/** A JavaScript execution-context record used by HTML's entry and callback algorithms. */
// https://html.spec.whatwg.org/multipage/webappapis.html#realm-execution-context
// This is Browlet's explicit model, separate from env.exec and the underlying VM context.
export class JSExecutionContext {
  realm: BrowletRealm;
  function: JSFunction | null = null;
  scriptOrModule: JSScriptOrModule | null = null;
  // https://html.spec.whatwg.org/multipage/webappapis.html#skip-when-determining-incumbent-counter
  skipWhenDeterminingIncumbent = 0;

  constructor(realm: BrowletRealm) {
    this.realm = realm;
  }
}

/** The realm-bearing portion shared by ECMAScript Script and Module records. */
// TODO(HTML §8.1.4): Supply full Script/Module records, including their HTML host-defined scripts.
export interface JSScriptOrModule {
  realm: BrowletRealm;
}
