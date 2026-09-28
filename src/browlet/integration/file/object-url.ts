import type { BrowletEnvironment } from '../../scripting/environment';
import { BlobImpl } from '../../../file/index';
import { arg, definePartialInterface, idlType, reference, staticOp } from '../../../web-idl/index';

/*
 * File API §8.4:
 * [Exposed=(Window,DedicatedWorker,SharedWorker)]
 * partial interface URL {
 *   static DOMString createObjectURL((Blob or MediaSource) obj);
 *   static undefined revokeObjectURL(DOMString url);
 * };
 */
export const objectURLIDL = definePartialInterface<BrowletEnvironment>({
  name: 'URL',
  exposed: ['Window', 'DedicatedWorker', 'SharedWorker'],
  members: [
    // PROVISIONAL: accept Blob until the real MediaSource implementation is available.
    staticOp('createObjectURL', idlType.DOMString,
      [arg('obj', reference(BlobImpl))],
      {
        invoke(context, object) {
          const env = context.realm.env;
          return env.userAgent.blobURLStore.add(object, env);
        },
      },
    ),
    staticOp('revokeObjectURL', idlType.undefined,
      [arg('url', idlType.DOMString)],
      {
        invoke(context, url) {
          const env = context.realm.env;
          env.userAgent.blobURLStore.revoke(url, env);
        },
      },
    ),
  ],
});
