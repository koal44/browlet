'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const names = ['makeJobCallback', 'callJobCallback', 'enqueuePromiseJob',
  'enqueueGenericJob', 'enqueueTimeoutJob'];

module.exports = native => function setHostHooks(hooks) {
  if (hooks === null || typeof hooks !== 'object') throw new TypeError('Expected host hooks');
  for (const key of Object.keys(hooks)) {
    if (!names.includes(key)) throw new TypeError('Unknown host hook: ' + key);
  }
  const { makeJobCallback, callJobCallback, enqueuePromiseJob,
    enqueueGenericJob, enqueueTimeoutJob } = hooks;
  const functions = [makeJobCallback, callJobCallback, enqueuePromiseJob,
    enqueueGenericJob, enqueueTimeoutJob];
  functions.forEach((hook, index) => {
    if (hook !== undefined && typeof hook !== 'function') {
      throw new TypeError(names[index] + ' must be a function');
    }
  });
  let capture, call;
  if (makeJobCallback || callJobCallback) {
    const registrations = new AsyncLocalStorage();
    const make = (callback, snapshot) => {
      const record = makeJobCallback
        ? registrations.run(undefined, makeJobCallback, callback, snapshot)
        : { callback, hostDefined: undefined };
      if (record === null || typeof record !== 'object' || record.callback !== callback) {
        throw new TypeError('makeJobCallback must return a record containing the original callback');
      }
      return record;
    };
    capture = (kind, snapshot, callback, onRejected) => {
      const records = kind === 'reaction'
        ? { fulfill: typeof callback === 'function' ? make(callback, snapshot) : undefined,
          reject: typeof onRejected === 'function' ? make(onRejected, snapshot) : undefined }
        : { [kind]: make(callback, snapshot) };
      return registrations.run(records, () => native.getContinuationData());
    };
    call = (callback, receiver, args, kind) => {
      const record = registrations.getStore()?.[kind];
      return registrations.run(undefined, () => record && callJobCallback
        ? callJobCallback(record, receiver, args)
        : Reflect.apply(callback, receiver, args));
    };
  }
  native.installHostHooks(capture, call, enqueuePromiseJob, enqueueGenericJob, enqueueTimeoutJob);
};
