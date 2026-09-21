/** Task delivery with its destination and task source already selected. */
export type TaskScheduling = {
  /** Queue a later task and return a handle for removing it before execution. */
  queueTask(steps: () => void): TaskHandle;
};

export type TaskHandle = {
  remove(): void;
};
