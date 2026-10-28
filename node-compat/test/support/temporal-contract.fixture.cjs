'use strict';

const compat = require('../../addon/index.cjs');
const context = compat.createContextHandle();
context.globalProxy.record = value => console.log(value);
const callback = {
  throw: () => { throw new Error('Broken internal clock'); },
  number: () => 42,
  promise: () => Promise.resolve(42n),
  'positive-overflow': () => 2n ** 63n,
  'negative-overflow': () => -(2n ** 63n) - 1n,
}[process.argv[2]];
compat.setTemporalHostSystemUTCEpochNanosecondsCallback(context.realm, callback);
compat.runInContext(`
  try { Temporal.Now.instant(); record('continued'); }
  catch { record('caught'); }
`, context);
