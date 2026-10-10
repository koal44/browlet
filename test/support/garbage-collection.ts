import { setImmediate } from 'node:timers/promises';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

/** Give unreachable targets several full collection opportunities across separate jobs. */
export async function collectGarbage(targets: WeakRef<object>[]): Promise<void> {
  // Expose collection only in a throwaway host context, not in a tested Window.
  setFlagsFromString('--expose-gc');
  let collect: () => void;
  try {
    collect = runInNewContext('gc') as () => void;
  } finally {
    setFlagsFromString('--no-expose-gc');
  }

  for (let attempt = 0; attempt < 10; attempt++) {
    // Dereferencing keeps a target alive until the current job ends.
    await setImmediate();
    collect();
    if (targets.every((target) => target.deref() === undefined)) return;
  }
}
