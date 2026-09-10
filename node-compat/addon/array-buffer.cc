#include <node.h>
#include "array-buffer.h"

namespace node_compat {
namespace {
#ifdef NODE_COMPAT_ARRAY_BUFFER_LENGTH_TRACKING
void IsLengthTracking(const v8::FunctionCallbackInfo<v8::Value>& args) {
  if (!args[0]->IsArrayBufferView()) {
    args.GetIsolate()->ThrowException(v8::Exception::TypeError(
        v8::String::NewFromUtf8Literal(args.GetIsolate(), "Expected an ArrayBuffer view")));
    return;
  }
  args.GetReturnValue().Set(args[0].As<v8::ArrayBufferView>()->IsLengthTracking());
}
#endif
}  // namespace

void InitializeArrayBuffer(v8::Local<v8::Object> exports,
                           v8::Local<v8::Context> context) {
#ifdef NODE_COMPAT_ARRAY_BUFFER_LENGTH_TRACKING
  NODE_SET_METHOD(exports, "isLengthTrackingArrayBufferView", IsLengthTracking);
#endif
}
}  // namespace node_compat
