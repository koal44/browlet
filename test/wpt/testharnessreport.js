/* global add_completion_callback, add_result_callback, setup, __wptComplete */

setup({ output: false });

const results = [];

add_result_callback((test) => {
  results.push({
    name: test.name,
    status: testStatus(test),
    message: test.message ?? null,
    stack: test.stack ?? null,
  });
});

add_completion_callback((_tests, harness) => {
  __wptComplete({
    harness: {
      status: harnessStatus(harness),
      message: harness.message ?? null,
    },
    tests: results,
  });
});

function testStatus(test) {
  if (test.status === test.PASS) return 'pass';
  if (test.status === test.FAIL) return 'fail';
  if (test.status === test.TIMEOUT) return 'timeout';
  return 'not-run';
}

function harnessStatus(harness) {
  if (harness.status === harness.OK) return 'ok';
  if (harness.status === harness.TIMEOUT) return 'timeout';
  return 'error';
}
