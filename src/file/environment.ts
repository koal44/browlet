import type { StreamsEnvironment, StreamsExecution } from '../streams/index';

/** The owning environment's execution facilities used by Blob and File. */
export interface FileEnvironment extends StreamsEnvironment {
  exec: FileExecution;
}

/** Blob stream facilities and the host's native text convention. */
export interface FileExecution extends StreamsExecution {
  /** Line ending used for Blob string parts when endings is "native". */
  nativeLineEnding: '\n' | '\r\n';
}
