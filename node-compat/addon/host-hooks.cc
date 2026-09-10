#include <node.h>
#include "host-hooks.h"

#include <unordered_map>

namespace node_compat {
namespace {
using namespace v8;

Local<String> Text(Isolate* isolate, const char* text) {
  return String::NewFromUtf8(isolate, text).ToLocalChecked();
}

void Set(Local<Context> context, Local<Object> object, const char* key,
         Local<Value> value) {
  object->CreateDataProperty(context, Text(Isolate::GetCurrent(), key), value).Check();
}

void Fail(Isolate* isolate, const char* code, const char* message) {
  auto context = isolate->GetCurrentContext();
  auto error = Exception::TypeError(Text(isolate, message)).As<Object>();
  Set(context, error, "code", Text(isolate, code));
  isolate->ThrowException(error);
}

void KeepRealm(const FunctionCallbackInfo<Value>&) {}

void GetRealm(const FunctionCallbackInfo<Value>& args) {
  auto isolate = args.GetIsolate();
  Local<Context> realm;
  if (!args[0]->IsObject() ||
      !args[0].As<Object>()->GetCreationContext().ToLocal(&realm)) {
    Fail(isolate, "ERR_INVALID_ARG_TYPE", "Expected a realm-owned object");
    return;
  }
  args.GetReturnValue().Set(GetRealmReference(realm));
}

void GetFunctionRealm(const FunctionCallbackInfo<Value>& args) {
  auto isolate = args.GetIsolate();
  auto value = args[0];
  if (!value->IsFunction()) {
    Fail(isolate, "ERR_INVALID_ARG_TYPE", "Expected a callable");
    return;
  }
  // Follow internal targets, never observable prototypes or proxy traps.
  for (;;) {
    if (value->IsProxy()) {
      auto proxy = value.As<Proxy>();
      if (proxy->IsRevoked()) {
        Fail(isolate, "ERR_REVOKED_PROXY", "Cannot get the realm of a revoked proxy");
        return;
      }
      value = proxy->GetTarget();
      continue;
    }
    auto bound = value.As<Function>()->GetBoundFunction();
    if (!bound->IsUndefined()) {
      value = bound;
      continue;
    }
    Local<Context> realm;
    if (!value.As<Object>()->GetCreationContext().ToLocal(&realm)) {
      Fail(isolate, "ERR_INVALID_ARG_TYPE", "Expected a realm-owned callable");
      return;
    }
    args.GetReturnValue().Set(GetRealmReference(realm));
    return;
  }
}

#ifdef NODE_COMPAT_HOST_HOOKS
enum Hook { kCapture, kCall, kPromiseEnqueue, kGenericEnqueue, kTimeoutEnqueue, kHookCount };

struct HookState {
  Isolate* isolate;
  Global<Function> hooks[kHookCount];
  bool capturing = false;
};

// File-private, per-thread lookup; Node environment cleanup owns each HookState.
// V8's hook callbacks do not receive our state pointer, so they look it up here.
thread_local std::unordered_map<Isolate*, HookState*> owners;

Local<Value> RealmValue(Local<Context> realm, Isolate* isolate) {
  return realm.IsEmpty() ? Local<Value>(Null(isolate)) : GetRealmReference(realm);
}

Local<Object> Snapshot(Isolate* isolate) {
  auto current = isolate->GetCurrentContext();
  auto entered = isolate->GetEnteredOrMicrotaskContext();
  auto incumbent = isolate->GetIncumbentContext();
  Local<Data> options;
  bool has_options = isolate->GetCurrentHostDefinedOptions(true).ToLocal(&options);
  auto result = Object::New(isolate);
  Set(current, result, "current", RealmValue(current, isolate));
  Set(current, result, "entered", RealmValue(entered, isolate));
  Set(current, result, "incumbent", RealmValue(incumbent, isolate));
  auto values = Array::New(isolate);
  if (has_options) {
    auto primitives = options.As<PrimitiveArray>();
    for (int i = 0; i < primitives->Length(); ++i) {
      values->CreateDataProperty(current, i, primitives->Get(isolate, i)).Check();
    }
  }
  Set(current, result, "hostDefinedOptions", values);
  return result;
}

Local<Value> Capture(const char* kind, Local<Value> callback,
                     Local<Value> on_rejected) {
  auto isolate = Isolate::GetCurrent();
  auto state = owners.at(isolate);
  auto ambient = isolate->GetContinuationPreservedEmbedderDataV2().As<Value>();
  if (state->capturing) return ambient;
  EscapableHandleScope scope(isolate);
  state->capturing = true;
  auto hook = state->hooks[kCapture].Get(isolate);
  Local<Value> argv[] = {Text(isolate, kind), Snapshot(isolate), callback, on_rejected};
  TryCatch caught(isolate);
  auto result = hook->Call(hook->GetCreationContext().ToLocalChecked(),
                           Undefined(isolate), 4, argv);
  state->capturing = false;
  if (result.IsEmpty()) {
    if (caught.HasTerminated()) caught.ReThrow();
    else node::FatalException(isolate, caught);
    return scope.Escape(ambient);
  }
  return scope.Escape(result.ToLocalChecked());
}

Local<Value> CapturePromise(PromiseJobKind kind, Local<Value> on_fulfilled_or_then,
                            Local<Value> on_rejected) {
  return Capture(kind == PromiseJobKind::kThenable ? "thenable" : "reaction",
                 on_fulfilled_or_then, on_rejected);
}

Local<Value> CaptureFinalizationRegistry(Local<Value> callback) {
  return Capture("cleanup", callback, Undefined(Isolate::GetCurrent()));
}

MaybeLocal<Value> Call(Local<Context> context, Local<Function> callback,
                       Local<Value> receiver, int argc, Local<Value> argv[],
                       const char* kind) {
  auto isolate = Isolate::GetCurrent();
  EscapableHandleScope scope(isolate);
  auto hook = owners.at(isolate)->hooks[kCall].Get(isolate);
  auto host = hook->GetCreationContext().ToLocalChecked();
  Context::Scope context_scope(host);
  auto arguments = Array::New(isolate, argc);
  for (int i = 0; i < argc; ++i) arguments->CreateDataProperty(host, i, argv[i]).Check();
  Local<Value> hook_args[] = {callback, receiver, arguments, Text(isolate, kind)};
  Local<Value> result;
  if (!hook->Call(host, Undefined(isolate), 4, hook_args).ToLocal(&result)) return {};
  return scope.Escape(result);
}

MaybeLocal<Value> CallPromise(Local<Context> context, PromiseCallbackKind kind,
                              Local<Function> callback, Local<Value> receiver,
                              int argc, Local<Value> argv[]) {
  return Call(context, callback, receiver, argc, argv,
      kind == PromiseCallbackKind::kThenable ? "thenable" :
      kind == PromiseCallbackKind::kFulfill ? "fulfill" : "reject");
}

MaybeLocal<Value> CallFinalizationRegistry(Local<Context> context,
                                          Local<Function> callback,
                                          Local<Value> held_value) {
  return Call(context, callback, Undefined(Isolate::GetCurrent()),
              1, &held_value, "cleanup");
}

bool Enqueue(Hook kind, int argc, Local<Value> argv[]) {
  auto isolate = Isolate::GetCurrent();
  auto hook = owners.at(isolate)->hooks[kind].Get(isolate);
  TryCatch caught(isolate);
  Local<Value> result;
  if (!hook->Call(hook->GetCreationContext().ToLocalChecked(),
                 Undefined(isolate), argc, argv).ToLocal(&result)) {
    if (caught.HasTerminated()) caught.ReThrow();
    else node::FatalException(isolate, caught);
    return true;
  }
  return !result->IsFalse();
}

void EnqueuePromise(Local<Context> realm, MicrotaskQueue* queue, PromiseJobKind kind,
                     Local<Function> job) {
  auto isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);
  auto info = Snapshot(isolate);
  Set(isolate->GetCurrentContext(), info, "kind",
      Text(isolate, kind == PromiseJobKind::kThenable ? "thenable" : "reaction"));
  Local<Value> argv[] = {job, RealmValue(realm, isolate), info};
  if (!Enqueue(kPromiseEnqueue, 3, argv)) queue->EnqueueMicrotask(isolate, job);
}

void EnqueueGeneric(Local<Context> realm, Local<Function> job) {
  auto isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);
  Local<Value> argv[] = {job, GetRealmReference(realm)};
  Enqueue(kGenericEnqueue, 2, argv);
}

void EnqueueTimeout(Local<Context> realm, Local<Function> job, double milliseconds) {
  auto isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);
  Local<Value> argv[] = {job, GetRealmReference(realm), Number::New(isolate, milliseconds)};
  Enqueue(kTimeoutEnqueue, 3, argv);
}

void InstallHooks(const FunctionCallbackInfo<Value>& args) {
  auto isolate = args.GetIsolate();
  auto state = static_cast<HookState*>(args.Data().As<External>()->Value());
  if (owners.contains(isolate)) {
    Fail(isolate, "ERR_HOST_HOOKS_INSTALLED", "Host hooks are already installed in this isolate");
    return;
  }
  for (int i = 0; i < kHookCount; ++i) {
    if (!args[i]->IsUndefined() && !args[i]->IsFunction()) {
      Fail(isolate, "ERR_INVALID_ARG_TYPE", "Host hooks must be functions");
      return;
    }
  }
  if (args[kCapture]->IsUndefined() != args[kCall]->IsUndefined()) {
    Fail(isolate, "ERR_INVALID_ARG_VALUE", "Native capture and call adapters must be installed together");
    return;
  }
  owners.emplace(isolate, state);
  for (int i = 0; i < kHookCount; ++i) {
    if (!args[i]->IsUndefined()) state->hooks[i].Reset(isolate, args[i].As<Function>());
  }
  if (!state->hooks[kCapture].IsEmpty()) {
    isolate->SetPromiseCaptureHook(CapturePromise);
    isolate->SetFinalizationRegistryCaptureHook(CaptureFinalizationRegistry);
    isolate->SetPromiseCallHook(CallPromise);
    isolate->SetFinalizationRegistryCallHook(CallFinalizationRegistry);
  }
  if (!state->hooks[kPromiseEnqueue].IsEmpty()) isolate->SetPromiseJobEnqueueHook(EnqueuePromise);
  if (!state->hooks[kGenericEnqueue].IsEmpty()) isolate->SetGenericJobEnqueueHook(EnqueueGeneric);
  if (!state->hooks[kTimeoutEnqueue].IsEmpty()) isolate->SetTimeoutJobEnqueueHook(EnqueueTimeout);
}

void GetContinuationData(const FunctionCallbackInfo<Value>& args) {
  args.GetReturnValue().Set(
      args.GetIsolate()->GetContinuationPreservedEmbedderDataV2().As<Value>());
}

#endif  // NODE_COMPAT_HOST_HOOKS
}  // namespace

v8::Local<v8::Object> GetRealmReference(v8::Local<v8::Context> context) {
  using namespace v8;
  auto isolate = Isolate::GetCurrent();
  Context::Scope scope(context);
  auto key = Private::ForApi(isolate, Text(isolate, "node-compat.realm"));
  auto binding = context->GetExtrasBindingObject();
  auto cached = binding->GetPrivate(context, key).ToLocalChecked();
  if (cached->IsObject()) return cached.As<Object>();
  auto reference = Object::New(isolate);
  // A private function retains its creation context through GC-visible edges.
  // The reference stays distinct even when its global proxy is reused.
  reference->SetPrivate(context, key, Function::New(context, KeepRealm, {}, 0,
      ConstructorBehavior::kThrow).ToLocalChecked()).Check();
  reference->DefineOwnProperty(context, Text(isolate, "global"), context->Global(),
      static_cast<PropertyAttribute>(ReadOnly | DontDelete)).Check();
  binding->SetPrivate(context, key, reference).Check();
  return reference;
}

void InitializeHostHooks(v8::Local<v8::Object> exports,
                         v8::Local<v8::Context> context) {
  using namespace v8;
  auto isolate = Isolate::GetCurrent();
  Set(context, exports, "getRealm", Function::New(context, GetRealm).ToLocalChecked());
  Set(context, exports, "getFunctionRealm", Function::New(context, GetFunctionRealm).ToLocalChecked());
#ifdef NODE_COMPAT_HOST_HOOKS
  Set(context, exports, "supportsHostHooks", True(isolate));
  auto state = new HookState{isolate};
  node::AddEnvironmentCleanupHook(isolate, [](void* pointer) {
    auto state = static_cast<HookState*>(pointer);
    auto isolate = state->isolate;
    auto found = owners.find(isolate);
    if (found != owners.end() && found->second == state) {
      isolate->SetPromiseCaptureHook(nullptr);
      isolate->SetFinalizationRegistryCaptureHook(nullptr);
      isolate->SetPromiseCallHook(nullptr);
      isolate->SetFinalizationRegistryCallHook(nullptr);
      isolate->SetPromiseJobEnqueueHook(nullptr);
      isolate->SetGenericJobEnqueueHook(nullptr);
      isolate->SetTimeoutJobEnqueueHook(nullptr);
      owners.erase(found);
    }
    delete state;
  }, state);
  auto data = External::New(isolate, state);
  Set(context, exports, "installHostHooks", Function::New(context, InstallHooks, data).ToLocalChecked());
  Set(context, exports, "getContinuationData",
      Function::New(context, GetContinuationData).ToLocalChecked());
#else
  Set(context, exports, "supportsHostHooks", False(isolate));
#endif
}

}  // namespace node_compat
