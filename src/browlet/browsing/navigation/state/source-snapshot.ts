import { PolicyContainer, SandboxingFlagSet } from '../../policy/index';
import type { DocumentImpl } from '../../../dom/nodes/index';
import type { BrowletEnvironment } from '../../../environment/index';

/** Retains the source Document's activation, sandbox, client, and policies for a navigation. */
// https://html.spec.whatwg.org/multipage/browsing-the-web.html#source-snapshot-params
export class SourceSnapshotParams {
  /** Whether the initiating Window had transient activation at capture. */
  hasTransientActivation: boolean;
  /** Active sandbox restrictions of the initiating Document. */
  sandboxingFlags: SandboxingFlagSet;
  /** Whether those restrictions permit downloads. */
  allowsDownloading: boolean;
  /** Source settings retained only for use as a Fetch request client. */
  fetchClient: BrowletEnvironment | null;
  /** Independent copy of the initiating Document's policies. */
  sourcePolicyContainer: PolicyContainer;

  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#snapshotting-source-snapshot-params
  constructor(sourceDocument: DocumentImpl | null) {
    if (sourceDocument === null) {
      this.hasTransientActivation = true;
      this.sandboxingFlags = new SandboxingFlagSet();
      this.allowsDownloading = true;
      this.fetchClient = null;
      this.sourcePolicyContainer = new PolicyContainer();
      return;
    }
    // HTML §6.4 activation notification/expiry remain explicit in Window.hasTransientActivation().
    this.hasTransientActivation = sourceDocument.getRelevantGlobalObject()!.hasTransientActivation();
    this.sandboxingFlags = sourceDocument.activeSandboxingFlagSet;
    this.allowsDownloading = !this.sandboxingFlags.has('sandboxed-downloads');
    this.fetchClient = sourceDocument.env;
    this.sourcePolicyContainer = sourceDocument.policyContainer.clone();
  }
}
