# Unit-test diagnostics

Set `BROWLET_TEST_DIAGNOSTICS` to an output directory to enable the shared Vitest setup. Normal local runs omit it. CI enables it for the Node/OS jobs and retains the results for seven days, including after failure. This observes the existing workload without changing worker counts, heap limits, test/hook deadlines, or collection policy.

Each test-worker process appends JSON Lines to its own file. Records include process/thread IDs, runtime, source file, monotonic time, and epoch time:

- File boundaries record heap, RSS, external buffers, available system memory, and the heap limit. Peak RSS is the process lifetime peak, not a per-file peak.
- One-second samples record memory, CPU time, and timer lateness. CPU time covers the whole process, including its worker threads; timer lateness can reflect GC, synchronous work, or scheduling contention.
- GC entries lasting at least 100 ms retain their original start time and duration. Observer delivery is asynchronous; the file receiving an entry is not necessarily where that collection began. Correlate timestamps rather than treating the callback's file as attribution.
- Cases that fail or take at least one second record their elapsed time, CPU time, and ending memory. The measured interval includes prerequisite hooks and cleanup, not just the timed test function. The failure flag precedes Vitest's expected-failure inversion, which is recorded separately.
- `test/browlet/workers/thread.test.ts` records every case's start and completion through cleanup. Synchronous appends and stderr output preserve the last reached case if the Vitest process exits abruptly. These records identify progress; they do not establish which operation caused a native crash.

Sampling starts in each file's `beforeAll` and stops in `afterAll`; it does not cover initial module loading. Dynamically skipped cases may not invoke their completion callbacks. The interval is unreferenced and no browser environment or task loop is modified.

```powershell
$env:BROWLET_TEST_DIAGNOSTICS = "$PWD/test-results/unit-diagnostics"
node scripts/with-node.mjs --base 26.8.1 --runtime stock vitest run --project=unit --maxWorkers=1 test/browlet/workers/thread.test.ts
```

`scripts/ci-diagnostics.ps1` configures only disposable GitHub Actions runners. Unit steps enable [Node fatal-error reports](https://nodejs.org/download/release/v24.19.0/docs/api/report.html), excluding environment variables and network-interface enumeration. Windows additionally enables [WER local minidumps](https://learn.microsoft.com/en-us/windows/win32/wer/collecting-user-mode-dumps) for `node.exe`, capped at three files, and collects application crash events naming Node. Neither mechanism guarantees a report for every exit; an exit code without a dump remains incomplete evidence. The script does not configure the developer's machine.
