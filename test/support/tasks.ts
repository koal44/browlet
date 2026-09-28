/** Enter outside a Promise job so checkpoint tests can drain native microtasks. */
export function runInHostTask(steps: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      try {
        steps();
        resolve();
      } catch (error) {
        reject(error instanceof Error
          ? error
          : new Error('Host task failed', { cause: error }));
      }
    });
  });
}
