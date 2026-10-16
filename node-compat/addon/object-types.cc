#include <node.h>
#include "object-types.h"

namespace node_compat {
namespace {

void IsWeakRef(const v8::FunctionCallbackInfo<v8::Value>& args) {
  args.GetReturnValue().Set(args[0]->IsWeakRef());
}

#if defined(NODE_COMPAT_FINALIZATION_REGISTRY_PREDICATE)
void IsFinalizationRegistry(const v8::FunctionCallbackInfo<v8::Value>& args) {
  args.GetReturnValue().Set(args[0]->IsFinalizationRegistry());
}
#endif

}  // namespace

void InitializeObjectTypes(v8::Local<v8::Object> exports) {
  NODE_SET_METHOD(exports, "isWeakRef", IsWeakRef);
#if defined(NODE_COMPAT_FINALIZATION_REGISTRY_PREDICATE)
  NODE_SET_METHOD(exports, "isFinalizationRegistry", IsFinalizationRegistry);
#endif
}

}  // namespace node_compat
