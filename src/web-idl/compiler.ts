import { compileHostFunction } from '../js-engine/index';

/** Compile host-side steps with property and call feedback isolated by label. */
export function compileSteps<Steps extends (...args: never[]) => unknown>(
  label: string, dependencies: Record<string, unknown>, source: string,
): Steps {
  // Ordinary closures from one body share feedback in V8. A distinct source
  // label keeps unrelated members apart, even when their algorithms are equal.
  // Callers supply trusted source and parameter names; declaration strings used
  // in the body must be encoded as literals, never interpolated as source code.
  // Exposed functions still use WebIDLRealm.createFunction for realm ownership.
  // Compile in the host even when lazy binding preparation begins in an author realm.
  const create = compileHostFunction(`
    "use strict";
    return (${source});
    //# sourceURL=webidl/${encodeURIComponent(label)}
  `, Object.keys(dependencies)) as (...values: unknown[]) => Steps;
  return create(...Object.values(dependencies));
}
