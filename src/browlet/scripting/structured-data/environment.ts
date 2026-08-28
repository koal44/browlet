import type { RealmBindings, WebIDLRealmHost } from '../../../web-idl/index';

/** Host state which HTML treats as ambient during structured-data operations. */
export type StructuredDataEnvironment = {
  readonly agentCluster: object;
  readonly interfaces: RealmBindings['interfaces'];
  readonly realm: WebIDLRealmHost;
};
