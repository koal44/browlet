import type { AbortExecution, StructuredDataExecution } from '../infra/execution';
import type { JSEnvironment, RealmExecution } from '../js-engine/index';

/** The owning environment's execution facilities used by Streams. */
export interface StreamsEnvironment extends JSEnvironment {
  exec: StreamsExecution;
}

/** Realm facilities with DOM abort and HTML structured-data operations. */
export interface StreamsExecution extends RealmExecution, AbortExecution, StructuredDataExecution {}
