import { fileClockHost, fileHost } from '../file/index';
import type { CapabilityImplementation } from '../web-idl/capability';
import { DocumentImpl } from './dom/nodes/document';
import { WindowImpl, windowIDL } from './browsing/window/window';
import {
  createTaskSource,
} from './scripting/event-loop';
import { queueGlobalTask } from './scripting/tasks';
import type { UserAgentFileHostOptions } from './user-agent';
import { wallClock } from './performance/clock';

export const fileClockHostCapability = fileClockHost.for(windowIDL, {
  currentUnixTime(global) {
    requireWindow(global);
    return wallClock.unsafeCurrentTime().milliseconds;
  },
}) satisfies CapabilityImplementation;

export const fileHostCapability = fileHost.for(windowIDL, {
  getNativeLineEnding(global) {
    return requireFileHost(global).nativeLineEnding;
  },
  queueFileReadingTask(global, steps) {
    requireWindow(global);
    queueGlobalTask(fileReadingTaskSource, global, steps);
  },
  runInParallel(global, steps) {
    requireFileHost(global).scheduleParallelSteps(steps);
  },
}) satisfies CapabilityImplementation;

function requireFileHost(global: object): UserAgentFileHostOptions {
  const window = requireWindow(global);
  const document = WindowImpl.getAssociatedDocument(window);
  const host = DocumentImpl.getBrowsingContext(document)
    ?.group?.userAgent?.fileHostOptions;
  if (!host) throw new Error('Window has no File host');
  return host;
}

function requireWindow(global: object): WindowImpl {
  if (!WindowImpl.is(global)) {
    throw new TypeError('File host requires a Window global');
  }
  return global;
}

const fileReadingTaskSource = createTaskSource('file reading');
