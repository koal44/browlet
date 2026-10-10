import { vi } from 'vitest';
import { WindowAgent, type Agent } from '../../src/browlet/scripting/agents';
import { EventLoop, type EventLoopInit } from '../../src/browlet/scripting/event-loop';
import { BrowletRealm, type BrowletRealmCreationOptions } from '../../src/browlet/scripting/realm';
import * as node from '../../src/browlet/integration/node';
import { UserAgent } from '../../src/browlet/user-agent';

/** Leave Window task turns under fixture control while retaining real realm setup. */
export function createManualUserAgent(): UserAgent {
  const userAgent = new UserAgent();
  vi.spyOn(userAgent, 'createWindowAgent').mockImplementation(() => new WindowAgent(createManualEventLoop()));
  return userAgent;
}

/** Capture host wake-ups while exercising real browser construction and task turns. */
export function mockEventLoopTurns(requestTurn: (steps: () => void) => void = () => {}): void {
  vi.spyOn(node, 'queueNodeTask').mockImplementation(requestTurn);
}

/** Supply inert wake-ups when a test advances the loop explicitly. */
export function createManualEventLoop(init: Partial<EventLoopInit> = {}): EventLoop {
  return new EventLoop({ requestTurn: () => {}, ...init });
}

/** Retain explicit Agent ownership without making every realm test assemble a scheduler. */
export function createManualRealm(options: BrowletRealmCreationOptions & { agent?: Agent; } = {}): BrowletRealm {
  const agent = options.agent ?? new WindowAgent(createManualEventLoop());
  return new BrowletRealm({ ...options, agent });
}
