/** An implementation failure, rather than an exception required by a web specification. */
// eslint-disable-next-line no-restricted-globals -- Internal diagnostics deliberately retain their native error identity.
export class InternalError extends Error {
  override name = 'InternalError';
}
