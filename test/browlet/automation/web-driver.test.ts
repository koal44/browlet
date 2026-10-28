import { afterEach, describe, expect, it, vi } from 'vitest';

import { InternalError, type InternalPromise } from '../../../src/infra/index';
import { UserAgent } from '../../../src/browlet/index';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/index';
import { WebDriverSession } from '../../../src/browlet/automation/index';
import type { CommandError, ExceptionDetails } from '../../../src/browlet/automation/protocol';
import { JSScriptRecord } from '../../../src/browlet/scripting/script';

afterEach(() => vi.restoreAllMocks());

// These exercise command orchestration with explicit dependency substitutes.
// They are not end-to-end BiDi tests: target lookup and
// protocol serialization remain unfinished.
describe('WebDriver BiDi script command algorithms', () => {
  it.each(['evaluate', 'callFunction'] as const)('completes %s on the host without a page checkpoint', async (command) => {
    const { driver, session, env, parameters } = fixture();
    const error: CommandError = { type: 'error', error: 'no such frame', message: 'missing target' };
    vi.spyOn(driver, 'getRealmFromTarget').mockReturnValue(error);
    const checkpoint = vi.spyOn(env.responsibleEventLoop, 'performMicrotaskCheckpoint');
    const result = command === 'evaluate'
      ? driver.evaluate(session, { ...parameters, expression: '42' })
      : driver.callFunction(session, { ...parameters, functionDeclaration: '() => 42' });

    expect(result).toBeInstanceOf(driver.userAgent.HostPromise);
    expect(await observe(result)).toBe(error);
    expect(checkpoint).not.toHaveBeenCalled();
  });

  it('creates a classic script, brackets evaluation, and returns the protocol result', async () => {
    const { driver, session, realm, env, parameters } = fixture();
    env.userAgent.scriptingEnabled = false;
    const parse = vi.spyOn(realm, 'parseScript');
    const sourceEvaluation = vi.spyOn(realm, 'evaluate');
    const prepare = vi.spyOn(env.responsibleEventLoop, 'prepareToRunScript');
    const cleanup = vi.spyOn(env.responsibleEventLoop, 'cleanUpAfterRunningScript');
    const scriptRecords: JSScriptRecord[] = [];
    vi.spyOn(JSScriptRecord.prototype, 'evaluate').mockImplementation(function(this: JSScriptRecord) {
      scriptRecords.push(this);
      expect(env.responsibleEventLoop.runningExecutionContext).toBe(env.realmExecutionContext);
      return { type: 'normal', value: 42 };
    });
    const serialize = vi.spyOn(driver, 'serializeAsRemoteValue').mockImplementation(() => {
      expect(env.responsibleEventLoop.executionContextStack).toHaveLength(0);
      return { type: 'number', value: 42 };
    });
    const command = driver.evaluate(session, {
      ...parameters, expression: 'globalThis.mustNotRun = true; 42',
      resultOwnership: 'root', serializationOptions: { maxObjectDepth: 2 },
    });
    expect(command).toBeInstanceOf(driver.userAgent.HostPromise);
    const result = await observe(command);

    expect(result).toEqual({ type: 'success', result: { type: 'number', value: 42 }, realm: driver.getRealmId(realm) });
    expect(parse.mock.calls[0]![0]).toBe('globalThis.mustNotRun = true; 42');
    expect(scriptRecords[0]!.script.baseURL).toBe(env.apiBaseURL);
    expect(scriptRecords[0]!.script.mutedErrors).toBe(false);
    expect(scriptRecords[0]!.script.originalSourceURL).toBeNull();
    expect(sourceEvaluation).not.toHaveBeenCalled();
    expect(Reflect.has(realm.globalObject, 'mustNotRun')).toBe(false);
    expect(prepare).toHaveBeenCalledExactlyOnceWith(env);
    expect(cleanup).toHaveBeenCalledExactlyOnceWith(env);
    expect(serialize).toHaveBeenCalledWith(
      42, { maxDomDepth: 0, maxObjectDepth: 2, includeShadowTree: 'none' }, 'root', new Map(), realm, session,
    );
  });

  it('executes the retained script with only target lookup and protocol serialization substituted', async () => {
    const { driver, session, realm, env, parameters } = fixture();
    const evaluate = vi.spyOn(JSScriptRecord.prototype, 'evaluate');
    const serialize = vi.spyOn(driver, 'serializeAsRemoteValue').mockImplementation((value) => {
      expect(env.responsibleEventLoop.executionContextStack).toHaveLength(0);
      expect(value).toBe(42);
      return { type: 'number', value: 42 };
    });

    expect(await observe(driver.evaluate(session, { ...parameters, expression: '21 * 2' }))).toEqual({
      type: 'success', result: { type: 'number', value: 42 }, realm: driver.getRealmId(realm),
    });
    expect(evaluate).toHaveBeenCalledOnce();
    expect(serialize).toHaveBeenCalledOnce();
  });

  it('returns an exception result for a throw completion instead of rejecting the command', async () => {
    const { driver, session, realm, parameters } = fixture();
    const completion = { type: 'throw' as const, value: 17 };
    vi.spyOn(JSScriptRecord.prototype, 'evaluate').mockReturnValue(completion);
    const details: ExceptionDetails = {
      text: '17', exception: { type: 'number', value: 17 },
      lineNumber: 0, columnNumber: 0, stackTrace: { callFrames: [] },
    };
    const describeException = vi.spyOn(driver, 'getExceptionDetails').mockReturnValue(details);
    expect(await observe(driver.evaluate(session, { ...parameters, expression: 'throw 17' }))).toEqual({
      type: 'exception', exceptionDetails: details, realm: driver.getRealmId(realm),
    });
    expect(describeException).toHaveBeenCalledWith(realm, completion, 'none', session);
  });

  it.each(['evaluate', 'callFunction'] as const)('returns a parse exception for invalid JavaScript in %s', async (command) => {
    const { driver, session, realm, env, parameters } = fixture();
    const parse = vi.spyOn(realm, 'parseScript');
    const evaluate = vi.spyOn(JSScriptRecord.prototype, 'evaluate');
    const sourceEvaluation = vi.spyOn(realm, 'evaluate');
    const awaitPromise = vi.spyOn(driver, 'awaitPromise');
    const serialize = vi.spyOn(driver, 'serializeAsRemoteValue');
    const details: ExceptionDetails = {
      text: 'SyntaxError', exception: { type: 'error' },
      lineNumber: 0, columnNumber: 0, stackTrace: { callFrames: [] },
    };
    const describeException = vi.spyOn(driver, 'getExceptionDetails').mockImplementation((actualRealm, completion) => {
      expect(actualRealm).toBe(realm);
      expect(completion.type).toBe('throw');
      expect(completion.value).toBeInstanceOf(realm.SyntaxError);
      expect(parse.mock.results[0]!.value).toEqual([completion.value]);
      expect(env.responsibleEventLoop.executionContextStack).toHaveLength(0);
      return details;
    });
    const result = command === 'evaluate'
      ? await observe(driver.evaluate(session, { ...parameters, expression: 'const =', awaitPromise: true }))
      : await observe(driver.callFunction(session, { ...parameters, functionDeclaration: 'function () {', awaitPromise: true }));

    expect(result).toEqual({ type: 'exception', exceptionDetails: details, realm: driver.getRealmId(realm) });
    expect(describeException).toHaveBeenCalledOnce();
    expect(evaluate).not.toHaveBeenCalled();
    expect(sourceEvaluation).not.toHaveBeenCalled();
    expect(awaitPromise).not.toHaveBeenCalled();
    expect(serialize).not.toHaveBeenCalled();
  });

  it('does not await a thenable when awaitPromise is true', async () => {
    const { driver, session, parameters } = fixture();
    const then = vi.fn(() => { throw new Error('The then getter must not be read'); });
    const value = Object.defineProperty({}, 'then', { get: then });
    vi.spyOn(JSScriptRecord.prototype, 'evaluate').mockReturnValue({ type: 'normal', value });
    const awaitPromise = vi.spyOn(driver, 'awaitPromise');
    const serialize = vi.spyOn(driver, 'serializeAsRemoteValue').mockReturnValue({ type: 'object' });
    const result = await observe(driver.evaluate(session, { ...parameters, awaitPromise: true, expression: '({ then() {} })' }));
    expect(result).toMatchObject({ type: 'success', result: { type: 'object' } });
    expect(serialize.mock.calls[0]![0]).toBe(value);
    expect(awaitPromise).not.toHaveBeenCalled();
    expect(then).not.toHaveBeenCalled();
  });

  it('retains a Promise result when awaitPromise is false', async () => {
    const { driver, session, realm, parameters } = fixture();
    const promise = new realm.NativePromise(() => {});
    vi.spyOn(JSScriptRecord.prototype, 'evaluate').mockReturnValue({ type: 'normal', value: promise });
    const awaitPromise = vi.spyOn(driver, 'awaitPromise');
    const serialize = vi.spyOn(driver, 'serializeAsRemoteValue').mockReturnValue({ type: 'promise' });
    expect(await observe(driver.evaluate(session, { ...parameters, expression: 'new Promise(() => {})' })))
      .toMatchObject({ type: 'success', result: { type: 'promise' } });
    expect(serialize.mock.calls[0]![0]).toBe(promise);
    expect(awaitPromise).not.toHaveBeenCalled();
  });

  it('deserializes arguments and an explicit receiver before evaluating and calling the function', async () => {
    const { driver, session, realm, env, parameters } = fixture();
    const receiver = realm.createOrdinaryObject(realm.objectPrototype);
    Reflect.set(receiver, 'base', 40);
    // The test supplies the function the missing retained-record backend would produce.
    const function_ = realm.evaluate('(function (increment) { "use strict"; return this.base + increment; })', 'fixture.js');
    const sourceEvaluation = vi.spyOn(realm, 'evaluate');
    const parse = vi.spyOn(realm, 'parseScript');
    const deserialize = vi.spyOn(driver, 'deserializeLocalValue')
      .mockReturnValueOnce({ type: 'success', data: 2 })
      .mockReturnValueOnce({ type: 'success', data: receiver });
    vi.spyOn(JSScriptRecord.prototype, 'evaluate').mockReturnValue({ type: 'normal', value: function_ });
    const activate = vi.spyOn(driver, 'activationNotification').mockImplementation(() => {});
    const serialize = vi.spyOn(driver, 'serializeAsRemoteValue').mockReturnValue({ type: 'number', value: 42 });
    const command = driver.callFunction(session, {
      ...parameters, functionDeclaration: 'function (increment) { return this.base + increment; }',
      arguments: [{ type: 'number', value: 2 }], this: { handle: 'receiver' }, userActivation: true,
    });
    expect(command).toBeInstanceOf(driver.userAgent.HostPromise);
    const result = await observe(command);

    expect(result).toMatchObject({ type: 'success', result: { type: 'number', value: 42 } });
    expect(parse.mock.calls[0]![0]).toBe('(function (increment) { return this.base + increment; })');
    expect(deserialize.mock.calls.map(([value]) => value)).toEqual([{ type: 'number', value: 2 }, { handle: 'receiver' }]);
    expect(activate).toHaveBeenCalledExactlyOnceWith(env);
    expect(serialize.mock.calls[0]![0]).toBe(42);
    expect(sourceEvaluation).not.toHaveBeenCalled();
    expect(env.responsibleEventLoop.executionContextStack).toHaveLength(0);
  });

  it('uses null as the default function receiver', async () => {
    const { driver, session, realm, parameters } = fixture();
    const function_ = realm.evaluate('(function () { "use strict"; return this; })', 'fixture.js');
    vi.spyOn(JSScriptRecord.prototype, 'evaluate').mockReturnValue({ type: 'normal', value: function_ });
    const serialize = vi.spyOn(driver, 'serializeAsRemoteValue').mockReturnValue({ type: 'null' });
    await observe(driver.callFunction(session, { ...parameters, functionDeclaration: 'function () { "use strict"; return this; }' }));
    expect(serialize.mock.calls[0]![0]).toBeNull();
  });

  it('returns invalid argument when the function declaration evaluates to a non-callable', async () => {
    const { driver, session, env, parameters } = fixture();
    vi.spyOn(JSScriptRecord.prototype, 'evaluate').mockReturnValue({ type: 'normal', value: 42 });
    const activate = vi.spyOn(driver, 'activationNotification');
    expect(await observe(driver.callFunction(session, { ...parameters, functionDeclaration: '42', userActivation: true })))
      .toMatchObject({ type: 'error', error: 'invalid argument' });
    expect(activate).not.toHaveBeenCalled();
    expect(env.responsibleEventLoop.executionContextStack).toHaveLength(0);
  });

  it('propagates target and argument protocol errors without executing source', async () => {
    const { driver, session, realm, parameters } = fixture();
    const parse = vi.spyOn(realm, 'parseScript');
    const error: CommandError = { type: 'error', error: 'no such frame', message: 'missing target' };
    vi.spyOn(driver, 'getRealmFromTarget').mockReturnValueOnce(error);
    expect(await observe(driver.evaluate(session, { ...parameters, expression: '42' }))).toBe(error);
    const invalid: CommandError = { type: 'error', error: 'invalid argument', message: 'invalid local value' };
    vi.spyOn(driver, 'deserializeLocalValue').mockReturnValue(invalid);
    expect(await observe(driver.callFunction(session, {
      ...parameters, functionDeclaration: '() => 42', arguments: [{ type: 'bigint', value: 'not a bigint' }],
    }))).toBe(invalid);
    expect(parse).not.toHaveBeenCalled();
  });

  it('cleans up after an internal execution failure without disguising it as an author exception', async () => {
    const { driver, session, realm, env, parameters } = fixture();
    const failure = new InternalError('execution facility unavailable');
    vi.spyOn(JSScriptRecord.prototype, 'evaluate').mockImplementation(() => { throw failure; });
    const sourceEvaluation = vi.spyOn(realm, 'evaluate');
    const details = vi.spyOn(driver, 'getExceptionDetails');
    const command = driver.evaluate(session, { ...parameters, expression: '42' });
    const result = observe(command);
    expect(command).toBeInstanceOf(driver.userAgent.HostPromise);
    await expect(result).rejects.toBe(failure);
    expect(sourceEvaluation).not.toHaveBeenCalled();
    expect(details).not.toHaveBeenCalled();
    expect(env.responsibleEventLoop.executionContextStack).toHaveLength(0);
  });

  it.each(['evaluate', 'callFunction'] as const)('unwinds %s when Await fails before suspending', async (command) => {
    const { driver, session, realm, env, parameters } = fixture();
    const promise = new realm.NativePromise(() => {});
    const failure = new InternalError('Await unavailable');
    const value = command === 'evaluate' ? promise : () => promise;
    vi.spyOn(JSScriptRecord.prototype, 'evaluate').mockReturnValue({ type: 'normal', value });
    const awaitPromise = vi.spyOn(driver, 'awaitPromise').mockImplementation(() => {
      expect(env.responsibleEventLoop.runningExecutionContext).toBe(env.realmExecutionContext);
      throw failure;
    });
    const serialize = vi.spyOn(driver, 'serializeAsRemoteValue');
    const details = vi.spyOn(driver, 'getExceptionDetails');
    const pending = command === 'evaluate'
      ? driver.evaluate(session, { ...parameters, expression: 'new Promise(() => {})', awaitPromise: true })
      : driver.callFunction(session, { ...parameters, functionDeclaration: '() => new Promise(() => {})', awaitPromise: true });

    await expect(observe(pending)).rejects.toBe(failure);
    expect(awaitPromise).toHaveBeenCalledExactlyOnceWith(promise, env);
    expect(serialize).not.toHaveBeenCalled();
    expect(details).not.toHaveBeenCalled();
    expect(env.responsibleEventLoop.executionContextStack).toHaveLength(0);
  });
});

function fixture() {
  const userAgent = new UserAgent();
  const navigable = TopLevelTraversable.create(userAgent, null, '');
  const env = navigable.activeDocument!.env;
  const realm = env.realm;
  const driver = userAgent.webDriver;
  const session = new WebDriverSession();
  const target = { realm: driver.getRealmId(realm) };
  vi.spyOn(driver, 'getRealmFromTarget').mockReturnValue({ type: 'success', data: realm });
  return { driver, session, realm, env, parameters: { target, awaitPromise: false } };
}

function observe<T>(promise: InternalPromise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => { promise.observe(resolve, reject); });
}
