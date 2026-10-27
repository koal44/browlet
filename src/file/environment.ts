import type { StreamsEnvironment } from '../streams/index';

/** The owning environment's stream facilities and host text convention used by Blob and File. */
export interface FileEnvironment extends StreamsEnvironment {
  /** Line ending used for Blob string parts when endings is "native". */
  nativeLineEnding: '\n' | '\r\n';
}
