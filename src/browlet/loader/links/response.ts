import { InternalError, nonASCIIWhitespacePattern } from '../../../infra/index';
import type { FetchResponse } from '../../../fetch/index';

import type { DocumentImpl } from '../../dom/nodes/index';

import { LinkProcessingOptions } from './options';

/** Prepare and dispatch final-response links belonging to this Document-loading phase. */
// https://html.spec.whatwg.org/multipage/semantics.html#process-link-headers
export function processLinkHeaders(document: DocumentImpl, response: FetchResponse, phase: LinkHeaderPhase): void {
  const mediaPhase = phase === 'media';
  for (const { href, rel, attributes } of response.headerList.extractLinks()) {
    const expectsMedia = attributes.has('srcset') || attributes.has('imagesrcset') || attributes.has('media');
    if (expectsMedia !== mediaPhase) continue;

    const media = attributes.get('media');
    // HTML §2.3.10 makes empty and ASCII-whitespace-only strings match without device inputs.
    if (media !== undefined && nonASCIIWhitespacePattern.test(media)) {
      // TODO(HTML §2.3.10 / Media Queries): Match against this Document through its style owner.
      // Stylelet has parsing/value resolution but no active-environment matcher or host measurements.
      // A real false result must skip this link; an unavailable matcher cannot supply that result.
      throw new InternalError('Link header media matching is not implemented');
    }

    const options = new LinkProcessingOptions(document.getBaseURL(), document.origin, document.policyContainer, document.env);
    options.href = href;
    options.document = document;
    // SPEC_CLASH(link-header-invalid-preload): HTML returns from the whole algorithm.
    // Follow the approved browser behavior, preserving later valid links.
    if (!options.applyHeaderAttributes(attributes, rel)) continue;

    if (attributes.has('imagesrcset') && attributes.has('imagesizes')) {
      // TODO(HTML §4.8.4.3): Create a source set from href, imagesrcset, imagesizes, and null,
      // then retain it on options.sourceSet. Source-set construction and selection need their image owner.
      throw new InternalError('Link header image source-set construction is not implemented');
    }
    options.processHeader(rel);
  }
}

export type LinkHeaderPhase = 'pre-media' | 'media';
