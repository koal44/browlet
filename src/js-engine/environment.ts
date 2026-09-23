import type { RealmExecution } from './realm-execution';

/** An environment owning execution and allocation facilities for one JavaScript realm. */
export interface JSEnvironment {
  /** Facilities shared by implementations belonging to this environment. */
  exec: RealmExecution;
}
