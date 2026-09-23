import type { BlobImpl } from '../../../file/index';
import { arg, definePartialInterface, idlType, reference, staticOp } from '../../../web-idl/index';
import type { Realm } from '../../scripting/realm';

/*
 * File API §8.4:
 * [Exposed=(Window,DedicatedWorker,SharedWorker)]
 * partial interface URL {
 *   static DOMString createObjectURL((Blob or MediaSource) obj);
 *   static undefined revokeObjectURL(DOMString url);
 * };
 */
export const objectURLIDL = definePartialInterface<Realm>({
  name: 'URL',
  exposed: ['Window', 'DedicatedWorker', 'SharedWorker'],
  members: [
    // PROVISIONAL: accept Blob until the real MediaSource implementation is available.
    staticOp('createObjectURL', idlType.DOMString,
      [arg('obj', reference('Blob'))],
      {
        invoke(context, object) {
          const environment = context.realm.environment;
          return environment.userAgent.blobURLStore.add(object as BlobImpl, environment);
        },
      },
    ),
    staticOp('revokeObjectURL', idlType.undefined,
      [arg('url', idlType.DOMString)],
      {
        invoke(context, url) {
          const environment = context.realm.environment;
          environment.userAgent.blobURLStore.revoke(url as string, environment);
        },
      },
    ),
  ],
});
