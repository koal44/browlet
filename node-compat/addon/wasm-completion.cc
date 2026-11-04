#include <node.h>
#include <unordered_map>
#include "wasm-completion.h"
#include "vm.h"

namespace node_compat {
namespace {
using namespace v8;

// Count addon environments without retaining their JavaScript contexts.
thread_local std::unordered_map<Isolate*, size_t> registrations;

struct Registration {
  Isolate* isolate;
};

Local<Private> SchedulerKey(Isolate* isolate) {
  return Private::ForApi(isolate,
      String::NewFromUtf8Literal(isolate, "node-compat.wasmCompletion"));
}

// Node leaves this callback at V8's default. V8 has no public getter or reset
// operation; preserve its Resolve/Reject behavior for contexts without a host.
// Another embedder's replacement of this isolate-wide hook cannot be chained.
void Resolve(Isolate* isolate, Local<Context> context,
             Local<Promise::Resolver> resolver, Local<Value> result,
             WasmAsyncSuccess success) {
  Context::Scope scope(context);
  MicrotasksScope microtasks(context, MicrotasksScope::kDoNotRunMicrotasks);
  auto settled = success == WasmAsyncSuccess::kSuccess
      ? resolver->Resolve(context, result) : resolver->Reject(context, result);
  // Resolution can encounter execution termination; leave it pending in V8.
  if (settled.IsNothing()) return;
}

void Complete(const FunctionCallbackInfo<Value>& args) {
  auto isolate = args.GetIsolate();
  auto data = args.Data().As<Array>();
  auto context = isolate->GetCurrentContext();
  auto resolver = data->Get(context, 0).ToLocalChecked();
  if (resolver->IsUndefined()) return;
  auto result = data->Get(context, 1).ToLocalChecked();
  auto success = data->Get(context, 2).ToLocalChecked()->IsTrue()
      ? WasmAsyncSuccess::kSuccess : WasmAsyncSuccess::kFail;
  // Consume before resolution: a then getter can reenter the host.
  data->Set(context, 0, Undefined(isolate)).Check();
  data->Set(context, 1, Undefined(isolate)).Check();
  // DetachGlobal clears the context's queue. A retained completion must not
  // run author accessors in that retired context or a replacement global.
  if (context->GetMicrotaskQueue() == nullptr) return;
  Resolve(isolate, context, resolver.As<Promise::Resolver>(), result, success);
}

void Dispatch(Isolate* isolate, Local<Context> context,
              Local<Promise::Resolver> resolver, Local<Value> result,
              WasmAsyncSuccess success) {
  HandleScope handles(isolate);
  auto scheduler = context->GetExtrasBindingObject()
      ->GetPrivate(context, SchedulerKey(isolate)).ToLocalChecked();
  if (!scheduler->IsFunction()) {
    Resolve(isolate, context, resolver, result, success);
    return;
  }
  if (context->GetMicrotaskQueue() == nullptr) return;
  // The completion and its captured values are traced JavaScript objects,
  // owned only by the host's queued work, not a native persistent registry.
  Context::Scope scope(context);
  Local<Value> values[] = {resolver, result,
      Boolean::New(isolate, success == WasmAsyncSuccess::kSuccess)};
  auto data = Array::New(isolate, values, 3);
  auto complete = Function::New(context, Complete, data, 0,
      ConstructorBehavior::kThrow).ToLocalChecked();
  // Identify the operation before resolving it; resolution can run author then getters.
  Local<Value> arguments[] = {complete, resolver->GetPromise()};
  auto callback = scheduler.As<Function>();
  TryCatch caught(isolate);
  if (callback->Call(callback->GetCreationContext().ToLocalChecked(),
                     Undefined(isolate), 2, arguments).IsEmpty()) {
    if (caught.HasTerminated()) caught.ReThrow();
    else node::FatalException(isolate, caught);
  }
}

void SetScheduler(const FunctionCallbackInfo<Value>& args) {
  auto isolate = args.GetIsolate();
  Local<Context> context;
  if (!GetContext(args, args[0]).ToLocal(&context)) return;
  if (!args[1]->IsFunction() && !args[1]->IsUndefined()) {
    isolate->ThrowException(Exception::TypeError(String::NewFromUtf8Literal(
        isolate, "Expected a WebAssembly completion scheduler or undefined")));
    return;
  }
  context->GetExtrasBindingObject()->SetPrivate(context, SchedulerKey(isolate), args[1]).Check();
}
}  // namespace

void InitializeWasmCompletion(v8::Local<v8::Object> exports,
                              v8::Local<v8::Context> context,
                              v8::Local<v8::External> vm_data) {
  auto isolate = v8::Isolate::GetCurrent();
  if (registrations[isolate]++ == 0) isolate->SetWasmAsyncResolvePromiseCallback(Dispatch);
  node::AddEnvironmentCleanupHook(isolate, [](void* pointer) {
    auto registration = static_cast<Registration*>(pointer);
    auto isolate = registration->isolate;
    auto entry = registrations.find(isolate);
    if (--entry->second == 0) {
      // nullptr is invalid for this hook. Restore the default behavior without
      // reading context-private state during the remaining isolate teardown.
      isolate->SetWasmAsyncResolvePromiseCallback(Resolve);
      registrations.erase(entry);
    }
    delete registration;
  }, new Registration{isolate});
  exports->CreateDataProperty(context,
      v8::String::NewFromUtf8Literal(isolate, "setWasmAsyncCompletionCallback"),
      v8::Function::New(context, SetScheduler, vm_data).ToLocalChecked()).Check();
}
}  // namespace node_compat
