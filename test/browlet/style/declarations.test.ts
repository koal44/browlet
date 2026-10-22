import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { declarationExpectations, exerciseDeclarations } from '../../stylelet/declarations.contracts';

describe('CSSOM declarations', () => {
  it.each(Object.keys(declarationExpectations) as (keyof typeof declarationExpectations)[])('%s', async (kind) => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(exerciseDeclarations, kind)).toEqual(declarationExpectations[kind]);
  });
});
