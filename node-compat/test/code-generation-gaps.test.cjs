'use strict';

const assert = require('node:assert/strict');
const { fixture } = require('./support/code-generation.cjs');
const { itPassesWith } = require('./support/test-runtime.cjs');
const testFullHook = itPassesWith('fullStringCompilation');

// V8's callback lacks the inputs required by HTML/CSP. Preserve Pip's four
// demonstrated requirements until an engine API can supply those inputs.
testFullHook('full compilation hook distinguishes eval and Function for identical source', () => {
  const f = fixture();
  f.evaluate('Function("a", "b", "return a + b")');
  const functionInput = f.calls.at(-1);
  f.context.globalProxy.input = functionInput[0];
  f.evaluate('(0, eval)(input)');
  assert.notDeepEqual(f.calls.at(-1), functionInput,
    'The engine must distinguish EVAL from FUNCTION for the Trusted Types sink name');
});

testFullHook('full compilation hook preserves original Function parameter boundaries', () => {
  const f = fixture();
  f.evaluate('Function("a,b", "return a + b")');
  const oneArgument = f.calls.at(-1);
  f.evaluate('Function("a", "b", "return a + b")');
  assert.notDeepEqual(f.calls.at(-1), oneArgument,
    'The full hook requires the original parameterStrings and parameterArgs lists');
});

testFullHook('Function accepts TrustedScript recognized by the host identity map', () => {
  const f = fixture();
  f.context.globalProxy.body = f.trusted('return 42');
  f.setPolicy((source, isCodeLike, original) => isCodeLike || f.sources.has(original));
  assert.doesNotThrow(() => {
    assert.equal(f.evaluate('Function(body)()'), 42);
  }, 'The host must receive the original body object to recognize its TrustedScript identity');
});

testFullHook('empty Function arguments do not fabricate a trusted body', () => {
  const f = fixture();
  f.setPolicy((source, isCodeLike, original) => isCodeLike || f.sources.has(original));
  assert.throws(() => f.evaluate('Function()'), f.evaluate('EvalError'),
    'With TrustedScript required and no default policy, the implicit empty string is not trusted');
});
