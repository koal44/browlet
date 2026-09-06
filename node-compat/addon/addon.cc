#include <node.h>
#include "vm.h"
#include "host-hooks.h"

namespace node_compat {
namespace {
void Initialize(v8::Local<v8::Object> exports, v8::Local<v8::Value>,
                v8::Local<v8::Context> context) {
  InitializeVm(exports, context);
  InitializeHostHooks(exports, context);
}
}  // namespace

NODE_MODULE_CONTEXT_AWARE(NODE_GYP_MODULE_NAME, Initialize)
}  // namespace node_compat
