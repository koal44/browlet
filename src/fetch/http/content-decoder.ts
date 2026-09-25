/** A single response's native decoder chain. Fetch owns coding selection and byte accounting. */
export interface HTTPContentDecoder {
  /** Supply encoded bytes; false suspends input until the drain notification. */
  write(bytes: Uint8Array): boolean;
  /** Finish input and validate the decoder's final state. */
  end(): void;
  /** Suspend decoded output while Fetch's byte buffer is full. */
  pause(): void;
  /** Resume decoded output when the consumer creates room. */
  resume(): void;
  /** Release decoder state without reporting another failure. */
  abort(): void;
}

/** Decoder notifications carry neutral bytes; page Stream mutations stay in Fetch tasks. */
export interface HTTPContentDecoderListener {
  onData(bytes: Uint8Array): void;
  onEnd(): void;
  onError(): void;
  onDrain(): void;
}
