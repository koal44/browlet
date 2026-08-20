/*
 * The URL Standard's host representation will be completed during the host
 * parsing audit. This provisional shape preserves the state already consumed
 * by HTML's site and agent-cluster algorithms.
 */
export type Host = {
  value: string;
  registrableDomain: Host | null;
};
