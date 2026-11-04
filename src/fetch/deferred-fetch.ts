/** Byte budgets a navigable container may reserve for its child. */
// https://fetch.spec.whatwg.org/#reserved-deferred-fetch-quota
// TODO(Fetch §4.12/§5.6): fetchLater must validate/buffer bodies, create pending records,
// and schedule activation. FetchGroup still throws if asked to process a pending record.
export const DeferredFetchQuota = Object.freeze({
  None: 0,
  Minimal: 8 * 1024,
  Normal: 64 * 1024,
});

/** Top-level capacity reserved for children using the minimal policy. */
// https://fetch.spec.whatwg.org/#quota-reserved-for-deferred-fetch-minimal
export const minimalDeferredFetchQuotaPool = 128 * 1024;
