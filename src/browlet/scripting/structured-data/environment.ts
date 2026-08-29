import type { BindingContext, WebIDLRealmHost } from '../../../web-idl/index';

/** Host state which HTML treats as ambient during structured-data operations. */
export type StructuredDataEnvironment = {
  readonly agentCluster: object;
  readonly context: BindingContext;
  readonly realm: WebIDLRealmHost;
};
