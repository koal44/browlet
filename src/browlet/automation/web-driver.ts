import { InternalError, internalType, type InternalPromise } from '../../infra/index';
import { isCallable, isPromiseObject, randomUUID } from '../../js-engine/index';
import type { URLRecord } from '../../url/index';

import { ClassicScript, ScriptFetchOptions, type BrowletRealm, type ScriptCompletion } from '../scripting/index';
import type { BrowletEnvironment } from '../environment';
import type { UserAgent } from '../user-agent';

import type {
  CallFunctionParameters, CommandError, EvaluateParameters, EvaluateResult, ExceptionDetails,
  LocalValue, RemoteValue, ResultOwnership, ScriptTarget, SerializationOptions, StepResult,
} from './protocol';

/** WebDriver BiDi remote-end algorithms, independent of Browlet's Node convenience API. */
export class WebDriver {
  userAgent: UserAgent;
  #realmIds = new WeakMap<BrowletRealm, string>();

  constructor(userAgent: UserAgent) {
    this.userAgent = userAgent;
  }

  /** Execute script.evaluate's remote-end steps with already-validated parameters. */
  // https://w3c.github.io/webdriver-bidi/#command-script-evaluate
  evaluate(session: WebDriverSession, parameters: EvaluateParameters): InternalPromise<EvaluateResult | CommandError> {
    const P = this.userAgent.HostPromise;
    return P.try(() => {
      const target = this.getRealmFromTarget(parameters.target);
      if (target.type === 'error') return target;
      const realm = target.data;
      const realmId = this.getRealmId(realm);
      const env = realm.env;
      const serializationOptions: Required<SerializationOptions> = {
        maxDomDepth: 0, maxObjectDepth: null, includeShadowTree: 'none', ...parameters.serializationOptions,
      };
      const ownership = parameters.resultOwnership ?? 'none';
      const options = new ScriptFetchOptions();
      const script = new ClassicScript(parameters.expression, env, env.apiBaseURL, options, false, null, true);
      if (parameters.userActivation === true) this.activationNotification(env);

      const result = this.#runScript(() => this.#evaluateRecord(script), parameters.awaitPromise, env);
      return P.fromInternal(result).then((completion) => {
        if (completion.type === 'throw') {
          return {
            type: 'exception', realm: realmId,
            exceptionDetails: this.getExceptionDetails(realm, completion, ownership, session),
          };
        }
        return {
          type: 'success', realm: realmId,
          result: this.serializeAsRemoteValue(completion.value, serializationOptions, ownership, new Map(), realm, session),
        };
      }, undefined, internalType<EvaluateResult>());
    }, internalType<EvaluateResult | CommandError>());
  }

  /** Execute script.callFunction's remote-end steps with already-validated parameters. */
  // https://w3c.github.io/webdriver-bidi/#command-script-callFunction
  callFunction(session: WebDriverSession, parameters: CallFunctionParameters): InternalPromise<EvaluateResult | CommandError> {
    const P = this.userAgent.HostPromise;
    return P.try(() => {
      const target = this.getRealmFromTarget(parameters.target);
      if (target.type === 'error') return target;
      const realm = target.data;
      const realmId = this.getRealmId(realm);
      const env = realm.env;
      const args = this.deserializeArguments(realm, parameters.arguments ?? [], session);
      if (args.type === 'error') return args;
      let receiver: unknown = null;
      if (parameters.this !== undefined) {
        const value = this.deserializeLocalValue(parameters.this, realm, session);
        if (value.type === 'error') return value;
        receiver = value.data;
      }
      const serializationOptions: Required<SerializationOptions> = {
        maxDomDepth: 0, maxObjectDepth: null, includeShadowTree: 'none', ...parameters.serializationOptions,
      };
      const ownership = parameters.resultOwnership ?? 'none';
      const baseURL = env.apiBaseURL;
      const options = new ScriptFetchOptions();
      const functionResult = this.evaluateFunctionBody(parameters.functionDeclaration, env, baseURL, options);
      if (functionResult.type === 'throw') {
        return {
          type: 'exception', realm: realmId,
          exceptionDetails: this.getExceptionDetails(realm, functionResult, ownership, session),
        };
      }
      const function_ = functionResult.value;
      if (!isCallable(function_)) {
        return { type: 'error', error: 'invalid argument', message: 'The function declaration did not evaluate to a callable' };
      }
      if (parameters.userActivation === true) this.activationNotification(env);

      const result = this.#runScript(() => {
        try {
          return { type: 'normal', value: Reflect.apply(function_, receiver, args.data) };
        } catch (error) {
          if (error instanceof InternalError) throw error;
          return { type: 'throw', value: error };
        }
      }, parameters.awaitPromise, env);
      return P.fromInternal(result).then((completion) => {
        if (completion.type === 'throw') {
          return {
            type: 'exception', realm: realmId,
            exceptionDetails: this.getExceptionDetails(realm, completion, ownership, session),
          };
        }
        return {
          type: 'success', realm: realmId,
          result: this.serializeAsRemoteValue(completion.value, serializationOptions, ownership, new Map(), realm, session),
        };
      }, undefined, internalType<EvaluateResult>());
    }, internalType<EvaluateResult | CommandError>());
  }

  /** Resolve protocol context/realm IDs; never accept a Navigable as a protocol target. */
  // https://w3c.github.io/webdriver-bidi/#get-a-realm-from-a-target
  getRealmFromTarget(_target: ScriptTarget): StepResult<BrowletRealm> {
    // TODO(WebDriver BiDi): Register context/realm creation and destruction, and implement sandbox selection.
    throw new InternalError('WebDriver target lookup is not implemented');
  }

  /** The realm's opaque protocol identifier, independent of context IDs and handles. */
  // https://w3c.github.io/webdriver-bidi/#realm-id
  getRealmId(realm: BrowletRealm): string {
    // Creation-event integration will also request this ID when the realm is created.
    let id = this.#realmIds.get(realm);
    if (id === undefined) {
      id = randomUUID();
      this.#realmIds.set(realm, id);
    }
    return id;
  }

  // https://w3c.github.io/webdriver-bidi/#deserialize-arguments
  deserializeArguments(realm: BrowletRealm, values: LocalValue[], session: WebDriverSession): StepResult<unknown[]> {
    const args: unknown[] = [];
    for (const value of values) {
      const result = this.deserializeLocalValue(value, realm, session);
      if (result.type === 'error') return result;
      args.push(result.data);
    }
    return { type: 'success', data: args };
  }

  // https://w3c.github.io/webdriver-bidi/#evaluate-function-body
  evaluateFunctionBody(
    declaration: string, env: BrowletEnvironment, baseURL: URLRecord, options: ScriptFetchOptions,
  ): ScriptCompletion {
    const script = new ClassicScript('(' + declaration + ')', env, baseURL, options, false, null, true);
    const loop = env.responsibleEventLoop;
    loop.prepareToRunScript(env);
    try {
      return this.#evaluateRecord(script);
    } finally {
      loop.cleanUpAfterRunningScript(env);
    }
  }

  // https://w3c.github.io/webdriver-bidi/#deserialize-local-value
  deserializeLocalValue(_value: LocalValue, _realm: BrowletRealm, _session: WebDriverSession): StepResult<unknown> {
    // TODO(WebDriver BiDi): Implement LocalValue, remote-reference, and channel deserialization.
    throw new InternalError('WebDriver LocalValue deserialization is not implemented');
  }

  // https://w3c.github.io/webdriver-bidi/#serialize-as-a-remote-value
  serializeAsRemoteValue(
    _value: unknown, _options: SerializationOptions, _ownership: ResultOwnership,
    _internalMap: Map<object | symbol, RemoteValue>, _realm: BrowletRealm, _session: WebDriverSession,
  ): RemoteValue {
    // TODO(WebDriver BiDi): Implement the specified serializer, depth limits, handles, and shared node IDs.
    throw new InternalError('WebDriver RemoteValue serialization is not implemented');
  }

  // https://w3c.github.io/webdriver-bidi/#get-exception-details
  getExceptionDetails(
    _realm: BrowletRealm, _completion: ScriptCompletion, _ownership: ResultOwnership, _session: WebDriverSession,
  ): ExceptionDetails {
    // TODO(WebDriver BiDi): Retain throw-site frames and serialize the exception using protocol rules.
    throw new InternalError('WebDriver exception details are not implemented');
  }

  /** Observe the author Promise and resume the script context when invoking the internal continuation. */
  // https://tc39.es/ecma262/#await
  awaitPromise(_promise: Promise<unknown>, _env: BrowletEnvironment): InternalPromise<ScriptCompletion> {
    // TODO(ECMAScript Await): Suspend/resume the modeled context with the continuation.
    // An InternalPromise alone does not supply that runtime integration.
    throw new InternalError('WebDriver script Await integration is not implemented');
  }

  // https://html.spec.whatwg.org/multipage/interaction.html#activation-notification
  activationNotification(_env: BrowletEnvironment): void {
    // TODO(HTML §6.4): Connect the activation-notification algorithm when implemented.
    throw new InternalError('User activation notification is not implemented');
  }

  #runScript(steps: () => ScriptCompletion, shouldAwait: boolean, env: BrowletEnvironment): InternalPromise<ScriptCompletion> {
    const loop = env.responsibleEventLoop;
    loop.prepareToRunScript(env);
    let completion: ScriptCompletion;
    try {
      completion = steps();
      if (completion.type === 'normal' && shouldAwait && isPromiseObject(completion.value)) {
        // Await owns suspension and resumption. Keep cleanup on its continuation;
        // the command switches to HostPromise only after this script work finishes.
        return this.awaitPromise(completion.value, env).then((result) => {
          loop.cleanUpAfterRunningScript(env);
          return result;
        }, (error) => {
          loop.cleanUpAfterRunningScript(env);
          throw error;
        });
      }
    } catch (error) {
      loop.cleanUpAfterRunningScript(env);
      throw error;
    }
    loop.cleanUpAfterRunningScript(env);
    return this.userAgent.HostPromise.resolve(completion, internalType<ScriptCompletion>());
  }

  #evaluateRecord(script: ClassicScript): ScriptCompletion {
    if (script.record === null) {
      // SPEC_GAP(bidi-script-parse-errors): BiDi omits HTML creation's null-record
      // branch. Follow Firefox, Chromium, and WPT: report the retained parse error
      // through the command's ordinary exception-result path.
      return { type: 'throw', value: script.parseError };
    }
    const completion = script.record.evaluate();
    if (completion === null) {
      // TODO(WebDriver BiDi): Connect command cancellation/realm destruction to
      // the backend's termination outcome; HTML's run algorithm is not this command.
      throw new InternalError('Aborted WebDriver script evaluation is not implemented');
    }
    return completion;
  }
}

/** Session identity only; session.new, capabilities, subscriptions, and transport remain unfinished. */
// https://w3c.github.io/webdriver/#dfn-session
export class WebDriverSession {
  id = randomUUID();
}
