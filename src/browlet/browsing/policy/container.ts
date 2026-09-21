import {
  createEmbedderPolicy, type EmbedderPolicy,
} from './coep';
import type { FetchPolicyContainer } from '../../../fetch/index';

export function createPolicyContainer(): PolicyContainer {
  return {
    cspList: [],
    embedderPolicy: createEmbedderPolicy(),
    referrerPolicy: 'strict-origin-when-cross-origin',
    integrityPolicy: {},
    reportOnlyIntegrityPolicy: {},
  };
}

export type PolicyContainer = FetchPolicyContainer & {
  cspList: object[];
  embedderPolicy: EmbedderPolicy;
  integrityPolicy: IntegrityPolicy;
  reportOnlyIntegrityPolicy: IntegrityPolicy;
};

export type IntegrityPolicy = Record<never, never>;
