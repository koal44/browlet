#include <node.h>
#include "promise.h"
#include "vm.h"

#include <unordered_map>

namespace node_compat {
namespace {
using namespace v8;

Local<String> Text(Isolate* isolate, const char* text) {
  return String::NewFromUtf8(isolate, text).ToLocalChecked();
}

void Fail(Isolate* isolate, const char* code, const char* message) {
  auto context = isolate->GetCurrentContext();
  auto error = Exception::TypeError(Text(isolate, message)).As<Object>();
  error->CreateDataProperty(context, Text(isolate, "code"), Text(isolate, code)).Check();
  isolate->ThrowException(error);
}

// Only Node's default rejection handler is supported as the forwarding target.
// The context retains the tracker; this lookup owns no JavaScript objects.
thread_local std::unordered_map<Isolate*, void*> rejection_owners;

Local<Private> RejectionTrackerKey(Isolate* isolate) {
  return Private::ForApi(isolate, Text(isolate, "browlet.promise-rejections.tracker"));
}

Local<Private> RejectionOwnerKey(Isolate* isolate) {
  return Private::ForApi(isolate, Text(isolate, "browlet.promise-rejections.hostOwned"));
}

void TrackPromiseRejection(PromiseRejectMessage message) {
  auto isolate = Isolate::GetCurrent();
  auto event = message.GetEvent();
  if (event != kPromiseRejectWithNoHandler && event != kPromiseHandlerAddedAfterReject) {
    node::PromiseRejectCallback(message);
    return;
  }
  HandleScope scope(isolate);
  auto context = isolate->GetCurrentContext();
  auto promise = message.GetPromise();
  auto tracker = context->GetExtrasBindingObject()
      ->GetPrivate(context, RejectionTrackerKey(isolate)).ToLocalChecked();
  auto key = RejectionOwnerKey(isolate);
  bool forward;
  if (event == kPromiseRejectWithNoHandler) {
    forward = !tracker->IsFunction();
    if (!forward) promise->SetPrivate(context, key, True(isolate)).Check();
  } else {
    // Forward matching handle notifications even across realms so Node can
    // clear its original report without reporting host promises to Node.
    forward = !promise->GetPrivate(context, key).ToLocalChecked()->IsTrue();
    promise->DeletePrivate(context, key).Check();
  }
  if (forward) node::PromiseRejectCallback(message);
  if (!tracker->IsFunction()) return;

  Local<Value> arguments[] = {promise, Text(isolate,
      event == kPromiseRejectWithNoHandler ? "reject" : "handle")};
  TryCatch caught(isolate);
  auto result = tracker.As<Function>()->Call(context, Undefined(isolate), 2, arguments);
  if (result.IsEmpty()) {
    // V8's notification callback cannot propagate an ordinary exception.
    if (caught.HasTerminated()) caught.ReThrow();
    else node::FatalException(isolate, caught);
  }
}

void SetPromiseRejectionTracker(const FunctionCallbackInfo<Value>& args) {
  auto isolate = args.GetIsolate();
  Local<Context> realm;
  if (!GetContext(args, args[0]).ToLocal(&realm)) return;
  if (!args[1]->IsFunction() && !args[1]->IsUndefined()) {
    Fail(isolate, "ERR_INVALID_ARG_TYPE", "Expected a rejection tracker or undefined");
    return;
  }
  auto data = args.Data().As<External>()->Value();
  auto owner = rejection_owners.find(isolate);
  if (owner != rejection_owners.end() && owner->second != data) {
    Fail(isolate, "ERR_REJECTION_TRACKER_OWNER", "This isolate already has a rejection tracker owner");
    return;
  }
  if (owner == rejection_owners.end()) {
    rejection_owners.emplace(isolate, data);
    isolate->SetPromiseRejectCallback(TrackPromiseRejection);
    node::AddEnvironmentCleanupHook(isolate, [](void* pointer) {
      auto isolate = static_cast<Isolate*>(pointer);
      isolate->SetPromiseRejectCallback(node::PromiseRejectCallback);
      rejection_owners.erase(isolate);
    }, isolate);
  }
  realm->GetExtrasBindingObject()->SetPrivate(realm, RejectionTrackerKey(isolate), args[1]).Check();
}

Local<Promise> GetPromise(const FunctionCallbackInfo<Value>& args) {
  if (!args[0]->IsPromise()) {
    Fail(args.GetIsolate(), "ERR_INVALID_ARG_TYPE", "Expected a native Promise");
    return {};
  }
  return args[0].As<Promise>();
}

void IsPromiseHandled(const FunctionCallbackInfo<Value>& args) {
  auto promise = GetPromise(args);
  if (!promise.IsEmpty()) args.GetReturnValue().Set(promise->HasHandler());
}

void GetPromiseResult(const FunctionCallbackInfo<Value>& args) {
  auto promise = GetPromise(args);
  if (promise.IsEmpty()) return;
  if (promise->State() == Promise::kPending) {
    Fail(args.GetIsolate(), "ERR_PROMISE_PENDING", "A pending Promise has no result");
    return;
  }
  args.GetReturnValue().Set(promise->Result());
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

void InitializePromise(v8::Local<v8::Object> exports, v8::Local<v8::Context> context,
                       v8::Local<v8::External> vm_data) {
  NODE_SET_METHOD(exports, "observePromise", ObservePromise);
  NODE_SET_METHOD(exports, "isPromiseHandled", IsPromiseHandled);
  NODE_SET_METHOD(exports, "getPromiseResult", GetPromiseResult);
  exports->CreateDataProperty(context, Text(Isolate::GetCurrent(), "setPromiseRejectionTracker"),
      Function::New(context, SetPromiseRejectionTracker, vm_data).ToLocalChecked()).Check();
}

}  // namespace node_compat
