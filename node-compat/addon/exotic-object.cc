#include "exotic-object.h"
#include "realm.h"

namespace node_compat {
namespace {
using namespace v8;

Local<String> Text(Isolate* isolate, const char* text) {
  return String::NewFromUtf8(isolate, text).ToLocalChecked();
}

void Fail(Isolate* isolate, const char* message) {
  isolate->ThrowException(Exception::TypeError(Text(isolate, message)));
}

// Proxy trap lookup happens in the accessing context, before entering a trap's
// function realm. Capture here; incumbent/entered contexts give different answers
// when a caller borrows another realm's Reflect methods.
MaybeLocal<Object> Handlers(Isolate* isolate, Local<Object> holder) {
  auto reference = GetRealmReference(isolate->GetCurrentContext());
  auto select = holder->GetInternalField(0).As<Function>();
  Local<Context> host;
  if (!select->GetCreationContext().ToLocal(&host)) return {};
  Local<Value> args[] = {reference};
  Local<Value> handlers;
  if (!select->Call(host, Undefined(isolate), 1, args).ToLocal(&handlers)) return {};
  if (!handlers->IsObject()) {
    Fail(isolate, "Exotic object selection must return handlers");
    return {};
  }
  return handlers.As<Object>();
}

Intercepted GetTrap(Local<Name> key, const PropertyCallbackInfo<Value>& info) {
  auto isolate = info.GetIsolate();
  Local<Object> handlers;
  Local<Value> method;
  if (Handlers(isolate, info.HolderV2()).ToLocal(&handlers) &&
      handlers->Get(isolate->GetCurrentContext(), key).ToLocal(&method)) {
    info.GetReturnValue().Set(method);
  }
  return Intercepted::kYes;
}

// The Proxy's private native target has no author property store. Its descriptor
// and key interceptors expose the same view as the public exotic object, so Proxy
// validation does not impose an ordinary object's permanently visible frozen keys.
MaybeLocal<Value> Inspect(Isolate* isolate, Local<Object> holder,
                          const char* name, int count, Local<Value>* args) {
  Local<Object> handlers;
  if (!Handlers(isolate, holder).ToLocal(&handlers)) return {};
  Local<Value> method;
  if (!handlers->Get(isolate->GetCurrentContext(), Text(isolate, name)).ToLocal(&method)) return {};
  if (!method->IsFunction()) {
    Fail(isolate, "Exotic object requires descriptor and key handlers");
    return {};
  }
  return method.As<Function>()->Call(isolate->GetCurrentContext(), handlers, count, args);
}

Intercepted Descriptor(Local<Name> key, const PropertyCallbackInfo<Value>& info) {
  auto holder = info.HolderV2();
  Local<Value> args[] = {holder, key};
  Local<Value> result;
  if (!Inspect(info.GetIsolate(), holder, "getOwnPropertyDescriptor", 2, args).ToLocal(&result)) {
    return Intercepted::kYes;
  }
  if (result->IsUndefined()) return Intercepted::kNo;
  info.GetReturnValue().Set(result);
  return Intercepted::kYes;
}

Intercepted IndexDescriptor(uint32_t index, const PropertyCallbackInfo<Value>& info) {
  auto isolate = info.GetIsolate();
  auto key = Integer::NewFromUnsigned(isolate, index)->ToString(isolate->GetCurrentContext()).ToLocalChecked();
  return Descriptor(key, info);
}

void Keys(const PropertyCallbackInfo<Array>& info) {
  Local<Value> args[] = {info.HolderV2()};
  Local<Value> result;
  if (!Inspect(info.GetIsolate(), info.HolderV2(), "ownKeys", 1, args).ToLocal(&result)) return;
  if (!result->IsArray()) {
    Fail(info.GetIsolate(), "Exotic ownKeys must return an array");
    return;
  }
  info.GetReturnValue().Set(result.As<Array>());
}

void Create(const FunctionCallbackInfo<Value>& args) {
  auto isolate = args.GetIsolate();
  Local<Context> context;
  // A retained realm can allocate after its Window context handle is detached.
  // The anchor must stay in that realm; a reused global proxy is not suitable.
  if (!args[0]->IsObject() || !args[0].As<Object>()->GetCreationContext().ToLocal(&context)) {
    Fail(isolate, "Exotic object requires a realm-owned anchor");
    return;
  }
  if (!args[1]->IsFunction()) {
    Fail(isolate, "Exotic object requires a handler selector");
    return;
  }
  Context::Scope scope(context);
  auto target_template = ObjectTemplate::New(isolate);
  target_template->SetInternalFieldCount(1);
  target_template->SetHandler(NamedPropertyHandlerConfiguration(
      nullptr, nullptr, nullptr, nullptr, Keys, nullptr, Descriptor));
  target_template->SetHandler(IndexedPropertyHandlerConfiguration(
      nullptr, nullptr, nullptr, nullptr, nullptr, nullptr, IndexDescriptor));
  auto handler_template = ObjectTemplate::New(isolate);
  handler_template->SetInternalFieldCount(1);
  handler_template->SetHandler(NamedPropertyHandlerConfiguration(GetTrap));
  Local<Object> target;
  Local<Object> handler;
  if (!target_template->NewInstance(context).ToLocal(&target) ||
      !handler_template->NewInstance(context).ToLocal(&handler)) return;
  // GC-traced fields retain the selector and its storage without native roots.
  target->SetInternalField(0, args[1]);
  handler->SetInternalField(0, args[1]);
  Local<Proxy> proxy;
  if (Proxy::New(context, target, handler).ToLocal(&proxy)) args.GetReturnValue().Set(proxy);
}
}  // namespace

void InitializeExoticObject(Local<Object> exports, Local<Context> context) {
  Local<Function> create;
  if (!Function::New(context, Create).ToLocal(&create)) return;
  exports->CreateDataProperty(context, Text(Isolate::GetCurrent(), "createExoticObject"), create).Check();
}
}  // namespace node_compat
