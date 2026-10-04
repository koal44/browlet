import {
  defineDictionary, dictMember, emptySequence, idlType, sequence,
} from '../../../web-idl/index';

/** Objects selected for transfer by a structured-clone operation. */
export type StructuredSerializeOptionsRecord = {
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
