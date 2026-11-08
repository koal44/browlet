import type { Navigable } from '../../../../src/browlet/browsing/navigation/navigable';
import type { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/top-level-traversable';
import type { Traversable } from '../../../../src/browlet/browsing/navigation/traversable';
import type { FetchPromptTarget } from '../../../../src/fetch/index';

// Checked by the ordinary TypeScript build without a separate runtime test.
export type PromptTargetContracts = [
  Assert<Traversable extends FetchPromptTarget ? true : false>,
  Assert<TopLevelTraversable extends FetchPromptTarget ? true : false>,
  Assert<Navigable extends FetchPromptTarget ? false : true>,
  Assert<{ id: symbol; } extends FetchPromptTarget ? false : true>,
];

type Assert<T extends true> = T;
