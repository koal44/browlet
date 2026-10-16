#include <node.h>
#include "array-buffer.h"
#include "vm.h"

namespace node_compat {
namespace {
void CloneSharedArrayBuffer(const v8::FunctionCallbackInfo<v8::Value>& args) {
  auto isolate = args.GetIsolate();
  v8::Local<v8::Context> context;
  if (!GetContext(args, args[1]).ToLocal(&context)) return;
  if (!args[0]->IsSharedArrayBuffer()) {
    isolate->ThrowException(v8::Exception::TypeError(
        v8::String::NewFromUtf8Literal(isolate, "Expected a SharedArrayBuffer")));
    return;
  }
  v8::Context::Scope scope(context);
  args.GetReturnValue().Set(v8::SharedArrayBuffer::New(
      isolate, args[0].As<v8::SharedArrayBuffer>()->GetBackingStore()));
}

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
                           v8::Local<v8::Context> context,
                           v8::Local<v8::External> vm_data) {
  v8::Local<v8::Function> clone;
  if (!v8::Function::New(context, CloneSharedArrayBuffer, vm_data).ToLocal(&clone) ||
      exports->Set(context, v8::String::NewFromUtf8Literal(
          v8::Isolate::GetCurrent(), "cloneSharedArrayBuffer"), clone).IsNothing()) return;
#ifdef NODE_COMPAT_ARRAY_BUFFER_LENGTH_TRACKING
  NODE_SET_METHOD(exports, "isLengthTrackingArrayBufferView", IsLengthTracking);
#endif
}
}  // namespace node_compat
