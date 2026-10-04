import type { DOMExceptionConstructor } from './dom-exception';

/** Web IDL allocation facilities supplied by an existing execution owner. */
export interface WebIDLExecution {
  /** Original constructor for exceptions whose realm must be fixed before delivery. */
  DOMException: DOMExceptionConstructor;
}
