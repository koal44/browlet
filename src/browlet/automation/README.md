# Browlet automation

This directory owns the host/page command boundary for `Browlet.evaluate()`
and `Browlet.exposeFunction()`.

- `evaluation.ts` owns one `PageEvaluation` per active Window. Commands and
  callback completions enter its HTML task queue. Navigation cancels pending
  evaluations and installs the retained host callbacks in the new Window.
- `evaluation-value.ts` copies arguments, results, and exceptions into the
  recipient's realm, preserving cycles and repeated references.

`evaluate(sourceOrFunction, argument)` sends source and a snapshot of its
argument, awaits the page result, and returns a copy to Node. Prefer functions
so TypeScript can check the code and infer its result. A function is serialized
as source; its closure stays in Node. Pass external data as the explicit
argument.

`exposeFunction` creates a page function returning a page Promise. The host
callback receives copies, and its Node Promise or thenable settles on Node's
queue. An HTML task delivers the copied completion back to the page before
its next microtask checkpoint.

The copy boundary supports primitive data except symbols, arrays, plain
objects, Date, RegExp, Map, Set, and Error. Error name, message, and stack are
text; causes are copied. Functions, proxies, DOM objects, and other live
values cannot be passed by reference. Handles, binary value transport, and a
Playwright wire protocol remain separate work.

This follows Playwright's [page callback controller](https://github.com/microsoft/playwright/blob/9ae53771fb320832c9b149be0bad26bf22361689/packages/injected/src/bindingsController.ts)
and [host completion delivery](https://github.com/microsoft/playwright/blob/9ae53771fb320832c9b149be0bad26bf22361689/packages/playwright-core/src/server/page.ts#L1078-L1093).
The [evaluation regression tests](../../../test/browlet/evaluation.test.ts)
exercise this boundary on stock and add-on runtimes. Direct `Realm.evaluate()`
remains available to the script runner and tests of exact realm identities or
individual checkpoints; those tests deliberately operate below this boundary.
