#include <node.h>
#include "vm.h"
#include "host-hooks.h"

namespace node_compat {
namespace {
using namespace v8;

void ObservePromise(const FunctionCallbackInfo<Value>& args);

void Initialize(v8::Local<v8::Object> exports, v8::Local<v8::Value>,
                v8::Local<v8::Context> context) {
  InitializeVm(exports, context);
  InitializeHostHooks(exports, context);
  NODE_SET_METHOD(exports, "observePromise", ObservePromise);
}

void ForwardPromiseResult(const FunctionCallbackInfo<Value>& args, bool rejected) {
  auto isolate = args.GetIsolate();
  if (args.Data()->IsUndefined()) {
    if (rejected) isolate->ThrowException(args[0]);
    else args.GetReturnValue().Set(args[0]);
    return;
  }
  auto callback = args.Data().As<Function>();
  auto context = callback->GetCreationContext().ToLocalChecked();
  Local<Value> value = args[0], result;
  if (callback->Call(context, Undefined(isolate), 1, &value).ToLocal(&result)) {
    args.GetReturnValue().Set(result);
  }
}

void Fulfilled(const FunctionCallbackInfo<Value>& args) {
  ForwardPromiseResult(args, false);
}

void Rejected(const FunctionCallbackInfo<Value>& args) {
  ForwardPromiseResult(args, true);
}

void ObservePromise(const FunctionCallbackInfo<Value>& args) {
  auto isolate = args.GetIsolate();
  if (!args[0]->IsPromise() || !args[1]->IsFunction() ||
      (!args[2]->IsFunction() && !args[2]->IsUndefined()) ||
      (!args[3]->IsFunction() && !args[3]->IsUndefined())) {
    isolate->ThrowException(Exception::TypeError(String::NewFromUtf8Literal(
        isolate, "Expected a Promise, realm anchor function, and optional reactions")));
    return;
  }
  auto context = args[1].As<Function>()->GetCreationContext().ToLocalChecked();
  Context::Scope scope(context);
  // The native forwarding functions select the observer's queue even when
  // its implementation callbacks were compiled in Node's context.
  auto fulfilled = Function::New(context, Fulfilled, args[2]).ToLocalChecked();
  auto rejected = Function::New(context, Rejected, args[3]).ToLocalChecked();
  Local<Promise> result;
  if (args[0].As<Promise>()->Then(context, fulfilled, rejected).ToLocal(&result)) {
    args.GetReturnValue().Set(result);
  }
}
}  // namespace

NODE_MODULE_CONTEXT_AWARE(NODE_GYP_MODULE_NAME, Initialize)
}  // namespace node_compat
