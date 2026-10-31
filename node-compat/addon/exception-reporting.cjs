'use strict';

/** Keep the private Node fallback inside the compatibility layer. */
module.exports = function exceptionReporting(native) {
  if (!native.getEnteredExceptionReporter) return native.setExceptionReporter;

  let installed = false;
  return function setExceptionReporter(context, reporter) {
    native.setExceptionReporter(context, reporter);
    if (installed || reporter === undefined) return;
    const original = process._fatalException;
    let reporting = false;
    // Official Node 24/26 offer no context-scoped reporting hook. This runs
    // before Node's monitor/capture handlers but after its explicit abort flag.
    // Do not tag the thrown value or infer ownership from its creation realm.
    process._fatalException = function(error, fromPromise) {
      if (!reporting && !fromPromise) {
        const handler = native.getEnteredExceptionReporter();
        if (handler !== undefined) {
          reporting = true;
          try {
            handler(error);
            return true;
          } catch (failure) {
            // Internal reporter failures remain Node errors, without recursion.
            return Reflect.apply(original, this, [failure, false]);
          } finally {
            reporting = false;
          }
        }
      }
      return Reflect.apply(original, this, [error, fromPromise]);
    };
    installed = true;
  };
};
