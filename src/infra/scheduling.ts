/** Task delivery with its destination and task source already selected. */
export type TaskScheduling = {
  /** Queue a later task and return a handle for removing it before execution. */
  queueTask(steps: () => void): TaskHandle;
  /** Schedule parallel work without invoking the steps inline. */
  runInParallel(steps: () => void): void;
};

export type TaskHandle = {
  remove(): void;
};
