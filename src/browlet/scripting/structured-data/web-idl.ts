import {
  defineDictionary, dictMember, emptySequence, idlType, sequence,
} from '../../../web-idl/core/index';

/** Objects selected for transfer by a structured-clone operation. */
export type StructuredSerializeOptions = {
  transfer?: object[];
};

/*
 * dictionary StructuredSerializeOptions {
 *   sequence<object> transfer = [];
 * };
 */
export const structuredSerializeOptionsIDL = defineDictionary({
  name: 'StructuredSerializeOptions',
  members: [dictMember('transfer', sequence(idlType.object),
    { default: emptySequence },
  )],
});
