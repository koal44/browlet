#include <node.h>
#include "array-buffer.h"
#include "host-hooks.h"
#include "html-all-collection.h"
#include "iterators.h"
#include "object-types.h"
#include "promise.h"
#include "realm.h"
#include "vm.h"

namespace node_compat {
namespace {

void Initialize(v8::Local<v8::Object> exports, v8::Local<v8::Value>,
                v8::Local<v8::Context> context) {
  auto vm_data = InitializeVm(exports, context);
  if (vm_data.IsEmpty()) return;
  InitializeArrayBuffer(exports, context, vm_data);
  InitializeRealm(exports, context);
  InitializeHostHooks(exports, context);
  InitializePromise(exports);
  InitializeObjectTypes(exports);
  InitializeIterators(exports, context, vm_data);
  InitializeHTMLAllCollection(exports, context, vm_data);
}

}  // namespace

NODE_MODULE_CONTEXT_AWARE(NODE_GYP_MODULE_NAME, Initialize)
}  // namespace node_compat
