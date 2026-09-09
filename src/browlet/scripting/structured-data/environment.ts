import type { BindingContext, WebIDLRealmHost } from '../../../web-idl/index';

/** Host state which HTML treats as ambient during structured-data operations. */
// BINDING_INTEGRATION: identify source platform objects and reconstruct destination platform objects.
export type StructuredDataEnvironment = {
  readonly agentCluster: object;
  readonly context: BindingContext;
  readonly realm: WebIDLRealmHost;
};
