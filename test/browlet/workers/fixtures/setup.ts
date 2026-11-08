import { unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TestProject } from 'vitest/node';

/** Prepare the isolate entry before Vitest starts its test workers. */
export default async function setup(project: TestProject): Promise<() => void> {
  const testFile = resolve(__dirname, '../thread.test.ts');
  let fixturePath: string | undefined;

  async function prepareFixture() {
    const started = performance.now();
    // Keep the compiler in global setup, including its imports. Unrelated
    // focused runs do not load Rollup or TypeScript for this fixture.
    const { buildWorkerFixture } = await import('./build.js');
    fixturePath = await buildWorkerFixture();
    project.provide('workerFixturePath', fixturePath);
    console.log(`[browlet] Worker fixture compiled in ${Math.round(performance.now() - started)} ms`);
  }

  // Vitest records the selected paths before global setup and collection.
  if (project.vitest.state.getPaths().some((file) => resolve(file) === testFile)) await prepareFixture();

  project.onTestsRerun(async (specifications) => {
    if (specifications.some((specification) =>
      specification.project === project && resolve(specification.moduleId) === testFile)) {
      await prepareFixture();
    }
  });

  return () => {
    if (fixturePath !== undefined) unlinkSync(fixturePath);
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    workerFixturePath?: string;
  }
}
