#include <node.h>
#include <node_version.h>
#include <string>
#include <unordered_map>
#include <utility>
#include "realm.h"
#include "global-access.h"

namespace node_compat {
namespace {
using namespace v8;

// Only registration counts are rooted here; selectors stay in their context's extras.
thread_local std::unordered_map<Isolate*, size_t> registrations;

struct Registration {
  Isolate* isolate;
};

Local<String> Text(Isolate* isolate, const char* text) {
  return String::NewFromUtf8(isolate, text).ToLocalChecked();
}
Local<Private> GuardKey(Isolate* isolate) {
  return Private::ForApi(isolate, Text(isolate, "node-compat.global-access"));
}

MaybeLocal<Object> Select(Local<Context> owner, Local<Context> accessing) {
  auto isolate = Isolate::GetCurrent();
  auto reference = GetRealmReference(accessing);
  Local<Value> selector;
  if (!owner->GetExtrasBindingObject()->GetPrivate(owner, GuardKey(isolate)).ToLocal(&selector)) return {};
  if (!selector->IsFunction()) {
    isolate->ThrowException(Exception::TypeError(Text(isolate, "Global access has not been connected")));
    return {};
  }
  auto method = selector.As<Function>();
  Local<Value> args[] = {reference};
  Local<Value> result;
  TryCatch caught(isolate);
  if (!method->Call(method->GetCreationContext().ToLocalChecked(), Undefined(isolate), 1, args).ToLocal(&result)) {
    caught.ReThrow();
    return {};
  }
  if (!result->IsObject()) {
    isolate->ThrowException(Exception::TypeError(Text(isolate, "Expected Global access operations")));
    return {};
  }
  return result.As<Object>();
}

bool Check(Local<Context> accessing, Local<Object> accessed, Local<Value> host_reference) {
  auto isolate = Isolate::GetCurrent();
  // This exact Node context is the composition root, not an arbitrary unregistered realm.
  if (GetRealmReference(accessing)->StrictEquals(host_reference)) return true;
  Local<Object> selected;
  if (!Select(accessed->GetCreationContext().ToLocalChecked(), accessing).ToLocal(&selected)) return false;
  Local<Value> allowed;
  return selected->Get(isolate->GetCurrentContext(), Text(isolate, "allow")).ToLocal(&allowed) && allowed->IsTrue();
}

MaybeLocal<Value> Call(Local<Context> owner, const char* name, int count, Local<Value>* args) {
  auto isolate = Isolate::GetCurrent();
  if (isolate->HasPendingException()) return {};
  auto accessing = isolate->GetCurrentContext();
  Local<Object> selected;
  if (!Select(owner, accessing).ToLocal(&selected)) return {};
  Local<Value> value;
  if (!selected->Get(accessing, Text(isolate, name)).ToLocal(&value)) return {};
  if (!value->IsFunction()) {
    isolate->ThrowException(Exception::TypeError(Text(isolate, "Missing Global access operation")));
    return {};
  }
  auto method = value.As<Function>();
  return method->Call(method->GetCreationContext().ToLocalChecked(), selected, count, args);
}

template <typename T>
MaybeLocal<Value> Call(const PropertyCallbackInfo<T>& info, const char* name, int count, Local<Value>* args) {
#if NODE_MAJOR_VERSION >= 26
  auto owner = info.HolderV2()->GetCreationContext().ToLocalChecked();
#else
  auto owner = info.Holder()->GetCreationContext().ToLocalChecked();
#endif
  return Call(owner, name, count, args);
}

void FailedAccess(Local<Object> target, AccessType, Local<Value>) {
  auto isolate = Isolate::GetCurrent();
  if (isolate->HasPendingException()) return;
  Local<Context> owner;
  if (!target->GetCreationContext().ToLocal(&owner) || target != owner->Global()) return;
  Local<Value> selector;
  if (!owner->GetExtrasBindingObject()->GetPrivate(owner, GuardKey(isolate)).ToLocal(&selector) ||
      !selector->IsFunction()) return;
  // These failures bypass property handlers. The host supplies the exception policy.
  (void)Call(owner, "deny", 0, nullptr);
}

Intercepted Get(Local<Name> key, const PropertyCallbackInfo<Value>& info) {
  if (info.GetIsolate()->HasPendingException()) return Intercepted::kYes;
  // Failed-access interception has no receiver on newer V8. The host selects its policy.
  Local<Value> args[] = {key};
  Local<Value> result;
  if (Call(info, "get", 1, args).ToLocal(&result)) info.GetReturnValue().Set(result);
  return Intercepted::kYes;
}

Intercepted Set(Local<Name> key, Local<Value> value, const PropertyCallbackInfo<void>& info) {
  if (info.GetIsolate()->HasPendingException()) return Intercepted::kYes;
  Local<Value> args[] = {key, value};
  Local<Value> result;
  if (Call(info, "set", 2, args).ToLocal(&result) && result->IsFalse()) info.GetReturnValue().SetFalse();
  return Intercepted::kYes;
}

Intercepted Descriptor(Local<Name> key, const PropertyCallbackInfo<Value>& info) {
  Local<Value> args[] = {key};
  Local<Value> result;
  if (Call(info, "getOwnPropertyDescriptor", 1, args).ToLocal(&result)) {
    if (result->IsUndefined()) return Intercepted::kNo;
    info.GetReturnValue().Set(result);
  }
  return Intercepted::kYes;
}

Intercepted Query(Local<Name> key, const PropertyCallbackInfo<Integer>& info) {
  Local<Value> args[] = {key};
  Local<Value> result;
  if (!Call(info, "getOwnPropertyDescriptor", 1, args).ToLocal(&result)) return Intercepted::kYes;
  if (result->IsUndefined()) return Intercepted::kNo;
  if (!result->IsObject()) {
    info.GetIsolate()->ThrowException(Exception::TypeError(Text(info.GetIsolate(), "Expected a property descriptor")));
    return Intercepted::kYes;
  }
  auto isolate = info.GetIsolate();
  int attributes = None;
  for (const auto& field : {std::pair{"writable", ReadOnly},
                            std::pair{"enumerable", DontEnum}, std::pair{"configurable", DontDelete}}) {
    Local<Value> value;
    if (!result.As<Object>()->Get(isolate->GetCurrentContext(), Text(isolate, field.first)).ToLocal(&value)) {
      return Intercepted::kYes;
    }
    if (value->IsFalse()) attributes |= field.second;
  }
  info.GetReturnValue().Set(attributes);
  return Intercepted::kYes;
}

void Keys(const PropertyCallbackInfo<Array>& info, const char* name) {
  Local<Value> result;
  if (Call(info, name, 0, nullptr).ToLocal(&result) && result->IsArray()) info.GetReturnValue().Set(result.As<Array>());
}
void NamedKeys(const PropertyCallbackInfo<Array>& info) { Keys(info, "ownKeys"); }
void IndexedKeys(const PropertyCallbackInfo<Array>& info) { Keys(info, "indices"); }
Local<String> Index(Isolate* isolate, uint32_t key) {
  return Text(isolate, std::to_string(key).c_str());
}
Intercepted GetIndex(uint32_t key, const PropertyCallbackInfo<Value>& info) {
  if (info.GetIsolate()->HasPendingException()) return Intercepted::kYes;
  return Get(Index(info.GetIsolate(), key), info);
}
Intercepted SetIndex(uint32_t key, Local<Value> value, const PropertyCallbackInfo<void>& info) {
  if (info.GetIsolate()->HasPendingException()) return Intercepted::kYes;
  return Set(Index(info.GetIsolate(), key), value, info);
}
Intercepted DescribeIndex(uint32_t key, const PropertyCallbackInfo<Value>& info) {
  if (info.GetIsolate()->HasPendingException()) return Intercepted::kYes;
  return Descriptor(Index(info.GetIsolate(), key), info);
}
Intercepted QueryIndex(uint32_t key, const PropertyCallbackInfo<Integer>& info) {
  if (info.GetIsolate()->HasPendingException()) return Intercepted::kYes;
  return Query(Index(info.GetIsolate(), key), info);
}
void Install(const FunctionCallbackInfo<Value>& args) {
  auto isolate = args.GetIsolate();
  Local<Context> owner;
  if (!args[0]->IsObject() || !args[1]->IsFunction() ||
      !args[0].As<Object>()->GetCreationContext().ToLocal(&owner) || args[0] != owner->Global() ||
      !owner->GetExtrasBindingObject()->HasPrivate(owner, GuardKey(isolate)).FromMaybe(false)) {
    isolate->ThrowException(Exception::TypeError(Text(isolate, "Expected an access-checked native global and selector")));
    return;
  }
  owner->GetExtrasBindingObject()->SetPrivate(owner, GuardKey(isolate), args[1]).Check();
}
}  // namespace

void PrepareGlobalAccess(v8::Local<v8::Context> context) {
  auto isolate = v8::Isolate::GetCurrent();
  // Mark guarded contexts before registration; other contexts cannot opt in after allocation.
  context->GetExtrasBindingObject()->SetPrivate(context, GuardKey(isolate), v8::Undefined(isolate)).Check();
}

void ConfigureGlobalAccess(v8::Isolate* isolate, v8::Local<v8::ObjectTemplate> object) {
  using namespace v8;
  object->SetAccessCheckCallbackAndHandler(Check,
      // Foreign definition/deletion bypass interceptors and use FailedAccess.
      NamedPropertyHandlerConfiguration(Get, Set, Query, nullptr, NamedKeys, nullptr, Descriptor),
      IndexedPropertyHandlerConfiguration(GetIndex, SetIndex, QueryIndex, nullptr, IndexedKeys, nullptr, DescribeIndex),
      GetRealmReference(isolate->GetCurrentContext()));
}

void InitializeGlobalAccess(v8::Local<v8::Object> exports, v8::Local<v8::Context> context) {
  auto isolate = v8::Isolate::GetCurrent();
  // This addon owns the isolate-wide hook; V8 has no getter for chaining another embedder's hook.
  if (registrations[isolate]++ == 0) isolate->SetFailedAccessCheckCallbackFunction(FailedAccess);
  node::AddEnvironmentCleanupHook(isolate, [](void* pointer) {
    auto registration = static_cast<Registration*>(pointer);
    auto isolate = registration->isolate;
    auto found = registrations.find(isolate);
    if (--found->second == 0) {
      isolate->SetFailedAccessCheckCallbackFunction(nullptr);
      registrations.erase(found);
    }
    delete registration;
  }, new Registration{isolate});
  exports->Set(context, Text(isolate, "setGlobalAccess"), v8::Function::New(context, Install).ToLocalChecked()).Check();
}
}  // namespace node_compat
