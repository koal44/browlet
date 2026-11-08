import { openSync, closeSync, mkdirSync, writeSync } from 'node:fs';
import { freemem } from 'node:os';
import { relative, resolve } from 'node:path';
import { performance, PerformanceObserver, type PerformanceEntry } from 'node:perf_hooks';
import { setInterval, clearInterval } from 'node:timers';
import { getHeapStatistics } from 'node:v8';
import { threadId } from 'node:worker_threads';
import { afterAll, beforeAll, beforeEach, expect } from 'vitest';

// Opt-in measurements of the real test workload; no forced collection or deadline changes.
const directory = process.env.BROWLET_TEST_DIAGNOSTICS;
if (directory) {
  let descriptor: number | undefined;
  let observer: PerformanceObserver;
  let interval: ReturnType<typeof setInterval>;
  let file: string;
  let traceCases: boolean;
  let sampledAt: number;
  let sampledCPU: NodeJS.CpuUsage;

  function record(event: string, details: object, print = false): void {
    if (descriptor === undefined) return;
    const now = performance.now();
    const line = JSON.stringify({
      event, pid: process.pid, threadId, file,
      base: process.env.NODE_BASE, runtime: process.env.NODE_RUNTIME,
      epochMs: round(performance.timeOrigin + now), atMs: round(now), ...details,
    }) + '\n';
    // Synchronous appends preserve the last completed record if the process crashes.
    writeSync(descriptor, line);
    if (print) writeSync(2, `[unit-diagnostics] ${line}`);
  }

  function memory() {
    const { heapUsed, rss, external, arrayBuffers } = process.memoryUsage();
    return {
      heapMiB: round(heapUsed / 2 ** 20), rssMiB: round(rss / 2 ** 20),
      externalMiB: round(external / 2 ** 20), arrayBuffersMiB: round(arrayBuffers / 2 ** 20),
      freeMiB: round(freemem() / 2 ** 20),
    };
  }

  function sample(): void {
    const now = performance.now();
    const cpu = process.cpuUsage();
    record('sample', {
      intervalMs: round(now - sampledAt), timerDelayMs: round(Math.max(0, now - sampledAt - 1000)),
      cpuMs: round((cpu.user + cpu.system - sampledCPU.user - sampledCPU.system) / 1000),
      ...memory(),
    });
    sampledAt = now;
    sampledCPU = cpu;
  }

  function collect(entries: PerformanceEntry[]): void {
    for (const entry of entries) {
      if (entry.duration >= 100) {
        // Delivery is asynchronous; correlate the entry's start time, not the callback time.
        record('gc', { startedMs: round(entry.startTime), durationMs: round(entry.duration) }, true);
      }
    }
  }

  beforeAll(() => {
    file = relative(process.cwd(), expect.getState().testPath!).replaceAll('\\', '/');
    traceCases = file === 'test/browlet/workers/thread.test.ts';
    mkdirSync(directory, { recursive: true });
    descriptor = openSync(resolve(directory, `unit-${process.pid}-${threadId}.jsonl`), 'a');
    sampledAt = performance.now();
    sampledCPU = process.cpuUsage();
    observer = new PerformanceObserver((list) => collect(list.getEntries()));
    observer.observe({ entryTypes: ['gc'] });
    interval = setInterval(sample, 1000);
    interval.unref();
    record('file-start', {
      node: process.version, heapLimitMiB: round(getHeapStatistics().heap_size_limit / 2 ** 20), ...memory(),
    });
  });

  beforeEach(({ task, onTestFinished }) => {
    const started = performance.now();
    const cpu = process.cpuUsage();
    if (traceCases) record('case-start', { id: task.id, name: task.fullTestName }, true);
    // Registered before the file's hooks, so stack-order completion follows its cleanup.
    onTestFinished(() => {
      const elapsedMs = performance.now() - started;
      const failed = task.result?.state === 'fail';
      if (traceCases || failed || elapsedMs >= 1000) {
        const used = process.cpuUsage(cpu);
        record('case-end', {
          id: task.id, name: task.fullTestName, startedMs: round(started), elapsedMs: round(elapsedMs),
          cpuMs: round((used.user + used.system) / 1000), failed,
          expectedFailure: task.fails === true, ...memory(),
        }, true);
      }
    });
  });

  afterAll(() => {
    if (descriptor === undefined) return;
    clearInterval(interval);
    collect(observer.takeRecords());
    observer.disconnect();
    record('file-end', { peakRssMiB: round(process.resourceUsage().maxRSS / 1024), ...memory() });
    closeSync(descriptor);
    descriptor = undefined;
  });
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
