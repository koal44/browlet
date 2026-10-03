import type { AssembledDictionary } from '../assembly/index';

/** Converted dictionary members with the declaration needed for subsequent conversion. */
// https://webidl.spec.whatwg.org/#idl-dictionaries
// SPEC_MISMATCH: dictionary value = ordered map from member names to values
export class IDLDictionary {
  /** Declared member types used for nested conversion to implementation values. */
  assembled: AssembledDictionary;
  /** Converted member payload, consumed in place by implementation conversion. */
  record: Record<string, unknown>;

  constructor(assembled: AssembledDictionary, record: Record<string, unknown>) {
    this.assembled = assembled;
    this.record = record;
  }
}
