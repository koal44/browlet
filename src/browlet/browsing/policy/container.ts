import {
  createEmbedderPolicy, type EmbedderPolicy,
} from './coep';

export function createPolicyContainer(): PolicyContainer {
  return {
    cspList: [],
    embedderPolicy: createEmbedderPolicy(),
    referrerPolicy: 'strict-origin-when-cross-origin',
    integrityPolicy: {},
    reportOnlyIntegrityPolicy: {},
  };
}

export type PolicyContainer = {
  cspList: object[];
  embedderPolicy: EmbedderPolicy;
  referrerPolicy: string;
  integrityPolicy: IntegrityPolicy;
  reportOnlyIntegrityPolicy: IntegrityPolicy;
};

export type IntegrityPolicy = Record<never, never>;
