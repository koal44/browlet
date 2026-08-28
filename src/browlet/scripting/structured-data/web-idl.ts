import {
  defineDictionary, dictMember, emptySequence, idlType, sequence,
} from '../../../web-idl/declaration/index';

/*
 * dictionary StructuredSerializeOptions {
 *   sequence<object> transfer = [];
 * };
 */
export const structuredSerializeOptionsIDL = defineDictionary({
  name: 'StructuredSerializeOptions',
  members: [dictMember(
    'transfer',
    sequence(idlType.object),
    { default: emptySequence },
  )],
});
