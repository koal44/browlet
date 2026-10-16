#include <node.h>
#include "realm.h"

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

struct RealmKey {
  Global<Private> key;
  size_t registrations = 0;
};

struct RealmKeyRegistration {
  Isolate* isolate;
};

// Retain only the lookup key, never the contexts or their realm references.
// Each addon environment releases its registration before isolate teardown.
thread_local std::unordered_map<Isolate*, RealmKey> realm_keys;

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

}  // namespace

v8::Local<v8::Object> GetRealmReference(v8::Local<v8::Context> context) {
  using namespace v8;
  auto isolate = Isolate::GetCurrent();
  Context::Scope scope(context);
  auto key = realm_keys.at(isolate).key.Get(isolate);
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

void InitializeRealm(v8::Local<v8::Object> exports, v8::Local<v8::Context> context) {
  using namespace v8;
  auto isolate = Isolate::GetCurrent();
  auto& realm_key = realm_keys[isolate];
  if (realm_key.registrations++ == 0) {
    realm_key.key.Reset(isolate, Private::ForApi(isolate, Text(isolate, "node-compat.realm")));
  }
  node::AddEnvironmentCleanupHook(isolate, [](void* pointer) {
    auto registration = static_cast<RealmKeyRegistration*>(pointer);
    auto found = realm_keys.find(registration->isolate);
    if (--found->second.registrations == 0) realm_keys.erase(found);
    delete registration;
  }, new RealmKeyRegistration{isolate});
  Set(context, exports, "getRealm", Function::New(context, GetRealm).ToLocalChecked());
  Set(context, exports, "getFunctionRealm", Function::New(context, GetFunctionRealm).ToLocalChecked());
}

}  // namespace node_compat
