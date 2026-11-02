import type { JSFunction } from '../../js-engine/index';

import type { BrowletEnvironment } from '../environment/index';

import type { BrowletRealm } from './realm';
import type { JSScriptOrModule } from './script';

/** A JavaScript execution-context record used by HTML's entry and callback algorithms. */
// https://html.spec.whatwg.org/multipage/webappapis.html#realm-execution-context
// This is Browlet's explicit model, separate from environment facilities and the underlying VM context.
export class JSExecutionContext {
  /** Realm whose execution this record represents. */
  realm: BrowletRealm;
  /** Executing function, or null for a context without a function. */
  function: JSFunction | null;
  /** Known script or module provenance, independent of any incumbent observation. */
  scriptOrModule: JSScriptOrModule | null;
  /** Author environment observed at native platform entry, or null without an observation. */
  incumbentEnv: BrowletEnvironment | null;
  /** Nesting depth of callbacks that hide this context from incumbent selection. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#skip-when-determining-incumbent-counter
  skipWhenDeterminingIncumbent = 0;

  constructor({ realm, function: function_ = null, scriptOrModule = null, incumbentEnv = null }: {
    realm: BrowletRealm;
    function?: JSFunction | null;
    scriptOrModule?: JSScriptOrModule | null;
    incumbentEnv?: BrowletEnvironment | null;
  }) {
    this.realm = realm;
    this.function = function_;
    this.scriptOrModule = scriptOrModule;
    this.incumbentEnv = incumbentEnv;
  }
}
