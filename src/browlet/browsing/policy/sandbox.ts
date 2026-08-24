export function createSandboxingFlagSet(): SandboxingFlagSet {
  return new Set();
}

export type SandboxingFlagSet = Set<SandboxingFlag>;

export type SandboxingFlag =
  | 'sandboxed-navigation'
  | 'sandboxed-auxiliary-navigation'
  | 'sandboxed-top-level-navigation-without-user-activation'
  | 'sandboxed-top-level-navigation-with-user-activation'
  | 'sandboxed-origin'
  | 'sandboxed-forms'
  | 'sandboxed-pointer-lock'
  | 'sandboxed-scripts'
  | 'sandboxed-automatic-features'
  | 'sandboxed-document-domain'
  | 'sandbox-propagates-to-auxiliary-browsing-contexts'
  | 'sandboxed-modals'
  | 'sandboxed-orientation-lock'
  | 'sandboxed-presentation'
  | 'sandboxed-downloads'
  | 'sandboxed-custom-protocols-navigation';
