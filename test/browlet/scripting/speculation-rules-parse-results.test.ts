import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InternalError } from '../../../src/infra/index';
import { Browlet } from '../../../src/browlet/browlet';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import type { ErrorEvent } from '../../../src/browlet/platform';
import { SpeculationRulesParseResult, SpeculationRuleSet } from '../../../src/browlet/scripting/speculation-rules';
import { domManipulationTaskSource } from '../../../src/browlet/scripting/tasks';
import { getRelevantRealm } from '../../support/browlet-binding';
import { mockEventLoopTurns } from '../../support/browlet-agent';

beforeEach(() => mockEventLoopTurns());
afterEach(() => vi.restoreAllMocks());

// HTML §8.1.4.9 uses controlled §7.6 parser results, real Window error dispatch,
// and real task turns. These tests do not claim rule parsing or speculative loading.
describe('speculation rules parse results', () => {
  it('retains the parser result using the document and its current base URL without registering it', () => {
    const { env, document } = fixture();
    const baseURL = env.parseURL('https://rules.test/base/')!;
    document.url = baseURL;
    const input = '{"prefetch":[]}';
    const rules = new SpeculationRuleSet();
    const parse = vi.spyOn(SpeculationRuleSet, 'parse').mockReturnValue(rules);
    const consider = vi.spyOn(document, 'considerSpeculativeLoads');

    const result = document.createSpeculationRulesParseResult(input);

    expect(parse).toHaveBeenCalledExactlyOnceWith(input, document, baseURL);
    expect(result.speculationRuleSet).toBe(rules);
    expect(result.errorToRethrow).toBeNull();
    expect(document.speculationRuleSets).toEqual([]);
    expect(consider).not.toHaveBeenCalled();
  });

  it('retains the original parse exception without reporting it during creation', () => {
    const { env, window, document } = fixture();
    const error = new env.exec.TypeError('The top-level value must be an object');
    const listener = vi.fn();
    window.addEventListener('error', listener);
    const report = vi.spyOn(env, 'reportException');

    const result = failedResult(document, error);

    expect(result.speculationRuleSet).toBeNull();
    expect(result.errorToRethrow).toBe(error);
    expect(listener).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it('propagates internal parser failures instead of treating them as author parse errors', () => {
    const { document } = fixture();
    const failure = new InternalError('parser unavailable');
    vi.spyOn(SpeculationRuleSet, 'parse').mockImplementation(() => { throw failure; });

    expect(() => new SpeculationRulesParseResult('{}', document)).toThrow(failure);
  });
});

describe('register speculation rules', () => {
  it('appends to the registering Window\'s associated document before considering loads', () => {
    const source = fixture();
    const target = fixture();
    const result = parsedResult(source.document);
    const consider = vi.spyOn(target.document, 'considerSpeculativeLoads').mockImplementation(() => {
      expect(target.document.speculationRuleSets).toEqual([result.speculationRuleSet]);
    });

    target.global.registerSpeculationRules(result);

    expect(consider).toHaveBeenCalledOnce();
    expect(source.document.speculationRuleSets).toEqual([]);
  });

  it('reports an initial parse error synchronously at the registering Window', () => {
    const source = fixture();
    const target = fixture();
    const error = new source.env.exec.TypeError('Invalid speculation rules');
    const result = failedResult(source.document, error);
    const events: ErrorEvent[] = [];
    target.window.addEventListener('error', (event) => {
      events.push(event as ErrorEvent);
      event.preventDefault();
    });
    const sourceListener = vi.fn();
    source.window.addEventListener('error', sourceListener);
    const output = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consider = vi.spyOn(target.document, 'considerSpeculativeLoads');

    target.global.registerSpeculationRules(result);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ error, cancelable: true, isTrusted: true });
    expect(getRelevantRealm(events[0]!)).toBe(target.env.realm);
    expect(sourceListener).not.toHaveBeenCalled();
    expect(output).not.toHaveBeenCalled();
    expect(consider).not.toHaveBeenCalled();
    expect(target.document.speculationRuleSets).toEqual([]);
    expect(target.loop.getTaskQueue(domManipulationTaskSource).size).toBe(0);
  });

  it('queues requested errors as DOM manipulation tasks instead of dispatching during registration', () => {
    const { env, window, global, document, loop } = fixture();
    const error = new env.exec.TypeError('Invalid speculation rules');
    const result = failedResult(document, error);
    const events: ErrorEvent[] = [];
    window.addEventListener('error', (event) => {
      expect(loop.currentlyRunningTask?.source).toBe(domManipulationTaskSource);
      expect(loop.currentlyRunningTask?.document).toBe(document);
      events.push(event as ErrorEvent);
      event.preventDefault();
    });

    global.registerSpeculationRules(result, true);

    expect(events).toEqual([]);
    expect(loop.getTaskQueue(domManipulationTaskSource).size).toBe(1);
    expect(loop.runTaskTurn()).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]!.error).toBe(error);
    expect(document.speculationRuleSets).toEqual([]);
  });
});

describe('unregister speculation rules', () => {
  it('removes every occurrence of the same rule set, preserving other registrations', () => {
    const { global, document } = fixture();
    const removed = parsedResult(document);
    const retained = parsedResult(document);
    global.registerSpeculationRules(removed);
    global.registerSpeculationRules(retained);
    global.registerSpeculationRules(removed);
    expect(document.speculationRuleSets).toEqual([
      removed.speculationRuleSet, retained.speculationRuleSet, removed.speculationRuleSet,
    ]);
    const consider = vi.spyOn(document, 'considerSpeculativeLoads').mockImplementation(() => {
      expect(document.speculationRuleSets).toEqual([retained.speculationRuleSet]);
    });

    global.unregisterSpeculationRules(removed);

    expect(consider).toHaveBeenCalledOnce();
  });

  it('still considers loads when the successful result is no longer registered', () => {
    const { global, document } = fixture();
    const result = parsedResult(document);
    const consider = vi.spyOn(document, 'considerSpeculativeLoads');

    global.unregisterSpeculationRules(result);

    expect(document.speculationRuleSets).toEqual([]);
    expect(consider).toHaveBeenCalledOnce();
  });

  it('ignores a failed parse result without reporting it again or considering loads', () => {
    const { env, global, document, loop } = fixture();
    const result = failedResult(document, new env.exec.TypeError('Invalid rules'));
    const report = vi.spyOn(env, 'reportException');
    const consider = vi.spyOn(document, 'considerSpeculativeLoads');

    global.unregisterSpeculationRules(result);

    expect(document.speculationRuleSets).toEqual([]);
    expect(report).not.toHaveBeenCalled();
    expect(consider).not.toHaveBeenCalled();
    expect(loop.getTaskQueue(domManipulationTaskSource).size).toBe(0);
  });
});

describe('update speculation rules', () => {
  it('removes the old rule set and appends its replacement before considering loads once', () => {
    const { global, document } = fixture();
    const oldResult = parsedResult(document);
    const other = parsedResult(document);
    const newResult = parsedResult(document);
    global.registerSpeculationRules(oldResult);
    global.registerSpeculationRules(other);
    global.registerSpeculationRules(oldResult);
    const consider = vi.spyOn(document, 'considerSpeculativeLoads').mockImplementation(() => {
      expect(document.speculationRuleSets).toEqual([other.speculationRuleSet, newResult.speculationRuleSet]);
    });

    global.updateSpeculationRules(oldResult, newResult);

    expect(consider).toHaveBeenCalledOnce();
  });

  it('removes the old rule set immediately and reports a replacement error in a later task', () => {
    const { env, window, global, document, loop } = fixture();
    const oldResult = parsedResult(document);
    global.registerSpeculationRules(oldResult);
    const error = new env.exec.TypeError('Invalid replacement rules');
    const newResult = failedResult(document, error);
    const events: ErrorEvent[] = [];
    window.addEventListener('error', (event) => {
      expect(document.speculationRuleSets).toEqual([]);
      events.push(event as ErrorEvent);
      event.preventDefault();
    });
    const consider = vi.spyOn(document, 'considerSpeculativeLoads');

    global.updateSpeculationRules(oldResult, newResult);

    expect(document.speculationRuleSets).toEqual([]);
    expect(events).toEqual([]);
    // Update delegates consideration to registration, which returns early on errors.
    expect(consider).not.toHaveBeenCalled();
    expect(loop.runTaskTurn()).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]!.error).toBe(error);
  });

  it('can replace a failed result with a successful one without reporting the old error', () => {
    const { env, global, document, loop } = fixture();
    const oldResult = failedResult(document, new env.exec.TypeError('Invalid old rules'));
    const newResult = parsedResult(document);
    const report = vi.spyOn(env, 'reportException');
    const consider = vi.spyOn(document, 'considerSpeculativeLoads');

    global.updateSpeculationRules(oldResult, newResult);

    expect(document.speculationRuleSets).toEqual([newResult.speculationRuleSet]);
    expect(consider).toHaveBeenCalledOnce();
    expect(report).not.toHaveBeenCalled();
    expect(loop.getTaskQueue(domManipulationTaskSource).size).toBe(0);
  });
});

function parsedResult(document: DocumentImpl): SpeculationRulesParseResult {
  vi.spyOn(SpeculationRuleSet, 'parse').mockReturnValueOnce(new SpeculationRuleSet());
  return new SpeculationRulesParseResult('{"prefetch":[]}', document);
}

function failedResult(document: DocumentImpl, error: unknown): SpeculationRulesParseResult {
  vi.spyOn(SpeculationRuleSet, 'parse').mockImplementationOnce(() => { throw error; });
  return new SpeculationRulesParseResult('{', document);
}

function fixture() {
  const { window } = new Browlet({ route: () => '', reporting: false });
  const env = getRelevantRealm(window).env;
  return { window, env, global: env.window, document: env.window.getAssociatedDocument(), loop: env.responsibleEventLoop };
}
