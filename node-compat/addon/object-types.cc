#include <node.h>
#include "object-types.h"

namespace node_compat {
namespace {

void IsWeakRef(const v8::FunctionCallbackInfo<v8::Value>& args) {
  args.GetReturnValue().Set(args[0]->IsWeakRef());
}

}  // namespace

void InitializeObjectTypes(v8::Local<v8::Object> exports) {
  NODE_SET_METHOD(exports, "isWeakRef", IsWeakRef);
}

}  // namespace node_compat
