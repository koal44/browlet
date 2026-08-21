import {
  defineInterface, idlType, nullable, record, reference, sequence, union,
  type ArgumentDefinition, type Definition, type WebIDLType,
} from '../web-idl/definition';

/*
 * [Exposed=*,
 *  LegacyWindowAlias=webkitURL]
 * interface URL {
 *   constructor(USVString url, optional USVString base);
 *
 *   static URL? parse(USVString url, optional USVString base);
 *   static boolean canParse(USVString url, optional USVString base);
 *
 *   stringifier attribute USVString href;
 *   readonly attribute USVString origin;
 *            attribute USVString protocol;
 *            attribute USVString username;
 *            attribute USVString password;
 *            attribute USVString host;
 *            attribute USVString hostname;
 *            attribute USVString port;
 *            attribute USVString pathname;
 *            attribute USVString search;
 *   [SameObject] readonly attribute URLSearchParams searchParams;
 *            attribute USVString hash;
 *
 *   USVString toJSON();
 * };
 */
export const urlIDL = defineInterface({
  exposed: '*',
  extendedAttributes: [{
    kind: 'identifier-list',
    name: 'LegacyWindowAlias',
    values: ['webkitURL'],
  }],
  members: [
    {
      arguments: [
        { name: 'url', type: idlType.USVString },
        { name: 'base', optional: true, type: idlType.USVString },
      ],
      kind: 'constructor',
    },
    {
      arguments: [
        { name: 'url', type: idlType.USVString },
        { name: 'base', optional: true, type: idlType.USVString },
      ],
      kind: 'operation',
      name: 'parse',
      returns: nullable(reference('URL')),
      static: true,
    },
    {
      arguments: [
        { name: 'url', type: idlType.USVString },
        { name: 'base', optional: true, type: idlType.USVString },
      ],
      kind: 'operation',
      name: 'canParse',
      returns: idlType.boolean,
      static: true,
    },
    {
      kind: 'attribute', name: 'href', stringifier: true,
      type: idlType.USVString,
    },
    {
      kind: 'attribute', name: 'origin', readonly: true,
      type: idlType.USVString,
    },
    ...[
      'protocol', 'username', 'password', 'host', 'hostname', 'port',
      'pathname', 'search',
    ].map((name) => ({
      kind: 'attribute' as const,
      name,
      type: idlType.USVString,
    })),
    {
      extendedAttributes: [{ kind: 'no-arguments', name: 'SameObject' }],
      kind: 'attribute',
      name: 'searchParams',
      readonly: true,
      type: reference('URLSearchParams'),
    },
    { kind: 'attribute', name: 'hash', type: idlType.USVString },
    {
      arguments: [], kind: 'operation', name: 'toJSON',
      returns: idlType.USVString,
    },
  ],
  name: 'URL',
});

/*
 * [Exposed=*]
 * interface URLSearchParams {
 *   constructor(optional (sequence<sequence<USVString>> or record<USVString, USVString> or USVString) init = "");
 *
 *   readonly attribute unsigned long size;
 *
 *   undefined append(USVString name, USVString value);
 *   undefined delete(USVString name, optional USVString value);
 *   USVString? get(USVString name);
 *   sequence<USVString> getAll(USVString name);
 *   boolean has(USVString name, optional USVString value);
 *   undefined set(USVString name, USVString value);
 *
 *   undefined sort();
 *
 *   iterable<USVString, USVString>;
 *   stringifier;
 * };
 */
export const urlSearchParamsIDL = defineInterface({
  exposed: '*',
  members: [
    {
      arguments: [{
        default: '',
        name: 'init',
        optional: true,
        type: union(
          sequence(sequence(idlType.USVString)),
          record(idlType.USVString, idlType.USVString),
          idlType.USVString,
        ),
      }],
      kind: 'constructor',
    },
    {
      kind: 'attribute', name: 'size', readonly: true,
      type: idlType.unsignedLong,
    },
    operation('append', idlType.undefined, [
      { name: 'name', type: idlType.USVString },
      { name: 'value', type: idlType.USVString },
    ]),
    operation('delete', idlType.undefined, [
      { name: 'name', type: idlType.USVString },
      { name: 'value', optional: true, type: idlType.USVString },
    ]),
    operation('get', nullable(idlType.USVString), [
      { name: 'name', type: idlType.USVString },
    ]),
    operation('getAll', sequence(idlType.USVString), [
      { name: 'name', type: idlType.USVString },
    ]),
    operation('has', idlType.boolean, [
      { name: 'name', type: idlType.USVString },
      { name: 'value', optional: true, type: idlType.USVString },
    ]),
    operation('set', idlType.undefined, [
      { name: 'name', type: idlType.USVString },
      { name: 'value', type: idlType.USVString },
    ]),
    operation('sort', idlType.undefined, []),
    {
      key: idlType.USVString,
      kind: 'iterable',
      value: idlType.USVString,
    },
    { kind: 'stringifier' },
  ],
  name: 'URLSearchParams',
});

export const urlIDLDefinitions: Definition[] = [
  urlIDL,
  urlSearchParamsIDL,
];

function operation(
  name: string,
  returns: WebIDLType,
  arguments_: ArgumentDefinition[],
) {
  return {
    arguments: arguments_,
    kind: 'operation' as const,
    name,
    returns,
  };
}
