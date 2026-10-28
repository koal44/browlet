#include <node.h>
#include "temporal.h"

namespace node_compat {
namespace {
#ifdef NODE_COMPAT_TEMPORAL_CLOCK
using namespace v8;

Local<Private> ClockKey(Isolate* isolate) {
  return Private::ForApi(isolate, String::NewFromUtf8Literal(isolate, "browlet.temporal.clock"));
}

int64_t HostSystemUTCEpochNanoseconds(Local<Context> context) {
  auto isolate = Isolate::GetCurrent();
  HandleScope handles(isolate);
  auto callback = context->GetExtrasBindingObject()->GetPrivate(context, ClockKey(isolate))
      .ToLocalChecked().As<Function>();
  auto host = callback->GetCreationContext().ToLocalChecked();
  Context::Scope scope(host);
  Local<Value> result;
  // V8 expects an infallible host clock and cannot propagate a callback error.
  // A placeholder result with a pending exception lets author code continue.
  // Contract violations are internal fatal errors, never clock readings.
  if (!callback->Call(host, Undefined(isolate), 0, nullptr).ToLocal(&result)) {
    node::OnFatalError("node-compat Temporal clock", "Clock callback must not throw");
  }
  if (!result->IsBigInt()) {
    node::OnFatalError("node-compat Temporal clock", "Clock callback must return a bigint");
  }
  bool lossless;
  auto nanoseconds = result.As<BigInt>()->Int64Value(&lossless);
  if (!lossless) {
    node::OnFatalError("node-compat Temporal clock", "Clock callback must return signed 64-bit nanoseconds");
  }
  return nanoseconds;
}

void SetTemporalHostSystemUTCEpochNanosecondsCallback(const FunctionCallbackInfo<Value>& args) {
  auto isolate = args.GetIsolate();
  if (!args[0]->IsObject() || (!args[1]->IsFunction() && !args[1]->IsUndefined())) {
    isolate->ThrowException(Exception::TypeError(String::NewFromUtf8Literal(
        isolate, "Expected a realm reference and a callback or undefined")));
    return;
  }
  Local<Context> context;
  if (!args[0].As<Object>()->GetCreationContext().ToLocal(&context)) return;
  auto state = context->GetExtrasBindingObject();
  if (args[1]->IsUndefined()) {
    context->SetTemporalHostSystemUTCEpochNanosecondsCallback(nullptr);
    state->DeletePrivate(context, ClockKey(isolate)).Check();
  } else {
    if (state->SetPrivate(context, ClockKey(isolate), args[1]).IsNothing()) return;
    context->SetTemporalHostSystemUTCEpochNanosecondsCallback(HostSystemUTCEpochNanoseconds);
  }
}
#endif
}  // namespace

void InitializeTemporal(v8::Local<v8::Object> exports) {
#ifdef NODE_COMPAT_TEMPORAL_CLOCK
  NODE_SET_METHOD(exports, "setTemporalHostSystemUTCEpochNanosecondsCallback",
      SetTemporalHostSystemUTCEpochNanosecondsCallback);
#endif
}
}  // namespace node_compat
