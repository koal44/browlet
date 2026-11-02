import { fileURLToPath, URL } from 'node:url';
import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import tseslint from 'typescript-eslint';
import ts from 'typescript';
import rule from '../../scripts/eslint/binding-input-arity.mjs';

RuleTester.describe = describe;
RuleTester.it = it;

const filename = fileURLToPath(new URL('../../binding-input-arity-fixture.ts', import.meta.url)).replaceAll('\\', '/');
const declarations = `
type Env = { name: string };
type Input = (env: Env, methodEnv: Env, incumbentEnv: Env | undefined) => unknown;
declare function atArg(index: number, resolve: Input): void;
type Attribute = {
  overrideCapturesIncumbent?: boolean;
  overrideGet?: (environments: { relevant: Env; callee: Env; incumbent: Env | undefined }) => unknown;
  overrideSet?: (environments: { relevant: Env; callee: Env; incumbent: Env | undefined }, value: unknown) => void;
};
declare function attr(options: Attribute): void;
declare const env: Env;
`;
const tester = new RuleTester({ languageOptions: { parser: tseslint.parser } });

tester.run('binding-input-arity', rule, {
  valid: [
    'atArg(0, (owner) => owner);',
    'atArg(0, (_env, _methodEnv, incumbentEnv) => incumbentEnv);',
    'attr({ overrideCapturesIncumbent: true, overrideGet({ incumbent }) { return incumbent; }, overrideSet(environments, value = null) {} });',
    'attr({ overrideGet(...inputs) { return inputs[0].incumbent; } });',
    'const unrelated = (value = 1, ...rest: unknown[]) => value;',
  ].map(testCase),
  invalid: [
    'atArg(0, (owner = env, method, incumbent) => incumbent);',
    'atArg(0, (owner, method, incumbent = env) => incumbent);',
    'atArg(0, (...inputs) => inputs[2]);',
    'const getter: Input = (owner, method, incumbent = env) => incumbent;',
  ].map((code) => ({ ...testCase(code), errors: [{ messageId: 'positional' }] })),
});

function testCase(body) {
  const code = declarations + body;
  // The rule needs real contextual types, but no repository project or library declarations.
  const options = { noLib: true, types: [], strict: true };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (name, target) => name === filename ? ts.createSourceFile(name, code, target, true) : undefined;
  const program = ts.createProgram([filename], options, host);
  return { filename, code, languageOptions: { parserOptions: { programs: [program] } } };
}
