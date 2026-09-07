import { rmSync } from 'node:fs';

for (const directory of ['dist', 'test-results']) {
  rmSync(new URL(`../${directory}/`, import.meta.url), { recursive: true, force: true });
}
