/** Converted dictionary members, distinguished from ordinary author objects during union conversion. */
// https://webidl.spec.whatwg.org/#idl-dictionaries
// SPEC_MISMATCH: dictionary value = ordered map from member names to values
export class IDLDictionary {
  /** Converted member payload, consumed in place by implementation conversion. */
  record: Record<string, unknown>;

  constructor(record: Record<string, unknown>) {
    this.record = record;
  }
}
