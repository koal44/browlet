#include "property-delegate.h"
#include <node_version.h>

namespace node_compat {
namespace {
using namespace v8;

Local<String> Text(Isolate* isolate, const char* value) {
  return String::NewFromUtf8(isolate, value).ToLocalChecked();
}

Local<Private> DelegateKey(Isolate* isolate) {
  return Private::ForApi(isolate, Text(isolate, "node-compat.property-delegate"));
}

template <typename T>
bool Call(const PropertyCallbackInfo<T>& info, const char* name, int count,
          Local<Value>* args, Local<Value>* result) {
  auto isolate = info.GetIsolate();
  auto context = isolate->GetCurrentContext();
  Local<Object> storage;
  if (info.Data()->IsTrue()) {
    Local<Context> owner;
#if NODE_MAJOR_VERSION >= 26
    // Newer V8 preserves the detached context in the callback's holder proxy.
    if (!info.HolderV2()->GetCreationContext().ToLocal(&owner)) return false;
#else
    // Node 24's HolderV2 follows the reused proxy into its new context.
    // Only use the deprecated hidden holder to retrieve the original context;
    // never expose that hidden object to JS.
    if (!info.Holder()->GetCreationContext().ToLocal(&owner)) return false;
#endif
    storage = owner->GetExtrasBindingObject();
  } else {
    storage = info.HolderV2();
  }
  Local<Value> delegate;
  if (!storage->GetPrivate(context, DelegateKey(isolate)).ToLocal(&delegate) ||
      !delegate->IsObject()) return false;
  Local<Value> method;
  if (!delegate.As<Object>()->Get(context, Text(isolate, name)).ToLocal(&method)) return true;
  if (!method->IsFunction()) {
    isolate->ThrowException(Exception::TypeError(Text(isolate, "Invalid property delegate")));
    return true;
  }
  (void) method.As<Function>()->Call(context, delegate, count, args).ToLocal(result);
  return true;
}

template <typename T>
Local<Value> DelegateReceiver(const PropertyCallbackInfo<T>& info) {
  // Contextual global receivers can be hidden objects. Only ordinary prototype
  // delegation needs a JS receiver; global delegation uses its bound target.
  if (info.Data()->IsTrue()) return Undefined(info.GetIsolate());
#if NODE_MAJOR_VERSION >= 26
  // Property callbacks no longer expose This(). Browlet's named-properties
  // delegate uses data properties and does not depend on the access receiver.
  return info.HolderV2();
#else
  return info.This();
#endif
}

Intercepted Get(Local<Name> key, const PropertyCallbackInfo<Value>& info) {
  Local<Value> args[] = {key, DelegateReceiver(info)};
  Local<Value> result;
  if (!Call(info, "has", 1, args, &result)) return Intercepted::kNo;
  if (result.IsEmpty()) return Intercepted::kYes;
  if (!result->BooleanValue(info.GetIsolate())) return Intercepted::kNo;
  if (!Call(info, "get", 2, args, &result)) return Intercepted::kNo;
  if (!result.IsEmpty()) info.GetReturnValue().Set(result);
  return Intercepted::kYes;
}

Intercepted Descriptor(Local<Name> key, const PropertyCallbackInfo<Value>& info) {
  Local<Value> args[] = {key};
  Local<Value> result;
  if (!Call(info, "descriptor", 1, args, &result)) return Intercepted::kNo;
  if (!result.IsEmpty() && result->IsUndefined()) return Intercepted::kNo;
  if (!result.IsEmpty()) info.GetReturnValue().Set(result);
  return Intercepted::kYes;
}

Intercepted Query(Local<Name> key, const PropertyCallbackInfo<Integer>& info) {
  Local<Value> args[] = {key};
  Local<Value> result;
  if (!Call(info, "query", 1, args, &result)) return Intercepted::kNo;
  if (!result.IsEmpty() && result->IsUndefined()) return Intercepted::kNo;
  if (!result.IsEmpty()) info.GetReturnValue().Set(result.As<Integer>());
  return Intercepted::kYes;
}

template <typename T>
void Reject(const PropertyCallbackInfo<T>& info) {
  if (info.ShouldThrowOnError()) {
    auto isolate = info.GetIsolate();
    isolate->ThrowException(Exception::TypeError(Text(isolate, "Property mutation rejected")));
  }
}

Intercepted Set(Local<Name> key, Local<Value> value,
                const PropertyCallbackInfo<void>& info) {
  Local<Value> args[] = {key, value, DelegateReceiver(info)};
  Local<Value> result;
  if (!Call(info, "set", 3, args, &result)) return Intercepted::kNo;
  if (!result.IsEmpty() && !result->BooleanValue(info.GetIsolate())) {
    info.GetReturnValue().SetFalse();
    Reject(info);
  }
  return Intercepted::kYes;
}

Intercepted Delete(Local<Name> key, const PropertyCallbackInfo<Boolean>& info) {
  Local<Value> args[] = {key};
  Local<Value> result;
  if (!Call(info, "delete", 1, args, &result)) return Intercepted::kNo;
  if (!result.IsEmpty()) {
    const bool success = result->BooleanValue(info.GetIsolate());
    info.GetReturnValue().Set(success);
    if (!success) Reject(info);
  }
  return Intercepted::kYes;
}

Intercepted Define(Local<Name> key, const PropertyDescriptor& descriptor,
                   const PropertyCallbackInfo<void>& info) {
  auto isolate = info.GetIsolate();
  auto context = isolate->GetCurrentContext();
  // The descriptor is transport data. Author changes to Object.prototype must
  // not add fields or intercept writes while we translate it for the delegate.
  auto object = Object::New(isolate, Null(isolate), nullptr, nullptr, 0);
  const auto put = [&](const char* key, Local<Value> value) {
    object->CreateDataProperty(context, Text(isolate, key), value).Check();
  };
  if (descriptor.has_value()) put("value", descriptor.value());
  if (descriptor.has_get()) put("get", descriptor.get());
  if (descriptor.has_set()) put("set", descriptor.set());
  if (descriptor.has_writable()) put("writable", Boolean::New(isolate, descriptor.writable()));
  if (descriptor.has_enumerable()) put("enumerable", Boolean::New(isolate, descriptor.enumerable()));
  if (descriptor.has_configurable()) put("configurable", Boolean::New(isolate, descriptor.configurable()));
  Local<Value> args[] = {key, object};
  Local<Value> result;
  if (!Call(info, "define", 2, args, &result)) return Intercepted::kNo;
  if (!result.IsEmpty() && !result->BooleanValue(isolate)) {
    info.GetReturnValue().SetFalse();
    Reject(info);
  }
  return Intercepted::kYes;
}

void Enumerate(const PropertyCallbackInfo<Array>& info) {
  Local<Value> result;
  if (Call(info, "keys", 0, nullptr, &result) && !result.IsEmpty() && result->IsArray()) {
    info.GetReturnValue().Set(result.As<Array>());
  }
}

Local<String> Index(Isolate* isolate, uint32_t index) {
  return Integer::NewFromUnsigned(isolate, index)
      ->ToString(isolate->GetCurrentContext()).ToLocalChecked();
}

Intercepted GetIndex(uint32_t index, const PropertyCallbackInfo<Value>& info) {
  return Get(Index(info.GetIsolate(), index), info);
}

Intercepted SetIndex(uint32_t index, Local<Value> value,
                     const PropertyCallbackInfo<void>& info) {
  return Set(Index(info.GetIsolate(), index), value, info);
}

Intercepted DescribeIndex(uint32_t index, const PropertyCallbackInfo<Value>& info) {
  return Descriptor(Index(info.GetIsolate(), index), info);
}

Intercepted QueryIndex(uint32_t index, const PropertyCallbackInfo<Integer>& info) {
  return Query(Index(info.GetIsolate(), index), info);
}

Intercepted DeleteIndex(uint32_t index, const PropertyCallbackInfo<Boolean>& info) {
  return Delete(Index(info.GetIsolate(), index), info);
}

Intercepted DefineIndex(uint32_t index, const PropertyDescriptor& descriptor,
                        const PropertyCallbackInfo<void>& info) {
  return Define(Index(info.GetIsolate(), index), descriptor, info);
}

void EnumerateIndices(const PropertyCallbackInfo<Array>& info) {
  Local<Value> result;
  if (Call(info, "indices", 0, nullptr, &result) && !result.IsEmpty() && result->IsArray()) {
    info.GetReturnValue().Set(result.As<Array>());
  }
}
}  // namespace

void ConfigurePropertyDelegate(v8::Isolate* isolate, v8::Local<v8::ObjectTemplate> object, bool global) {
  auto data = v8::Boolean::New(isolate, global);
  object->SetHandler(v8::NamedPropertyHandlerConfiguration(
      Get, Set, Query, Delete, Enumerate, Define, Descriptor, data));
  object->SetHandler(v8::IndexedPropertyHandlerConfiguration(
      GetIndex, SetIndex, QueryIndex, DeleteIndex, EnumerateIndices, DefineIndex, DescribeIndex, data));
}

void InitializePropertyDelegate(v8::Local<v8::Context> context,
                                v8::Local<v8::Object> object, bool global) {
  auto storage = global ? context->GetExtrasBindingObject() : object;
  auto isolate = v8::Isolate::GetCurrent();
  storage->SetPrivate(context, DelegateKey(isolate), v8::Null(isolate)).Check();
}

void SetPropertyDelegate(const v8::FunctionCallbackInfo<v8::Value>& args) {
  auto isolate = args.GetIsolate();
  auto context = isolate->GetCurrentContext();
  auto key = DelegateKey(isolate);
  if (!args[0]->IsObject() || !args[1]->IsObject()) {
    isolate->ThrowException(v8::Exception::TypeError(Text(isolate, "Expected a delegated object and handlers")));
    return;
  }
  auto storage = args[0].As<v8::Object>();
  v8::Local<v8::Context> owner;
  if (storage->GetCreationContext().ToLocal(&owner) && storage == owner->Global()) {
    storage = owner->GetExtrasBindingObject();
  }
  if (!storage->HasPrivate(context, key).FromMaybe(false)) {
    isolate->ThrowException(v8::Exception::TypeError(Text(isolate, "Object has no property delegation support")));
    return;
  }
  storage->SetPrivate(context, key, args[1]).Check();
}
}  // namespace node_compat
