#include "global-object.h"
#include <node_version.h>
#include <memory>
#include <string>

namespace node_compat {
namespace {
using namespace v8;

// Reflection sees stored properties, not synthetic global indices. Author
// accessors run after this scope has ended, so nested indexed access still works.
thread_local int reflection_depth = 0;
struct ReflectionScope {
  ReflectionScope() { ++reflection_depth; }
  ~ReflectionScope() { --reflection_depth; }
};

enum Slot { kStorage, kReader, kCaptureName, kCaptured, kSequence };

Local<String> Text(Isolate* isolate, const char* value) {
  return String::NewFromUtf8(isolate, value).ToLocalChecked();
}
Local<Private> StateKey(Isolate* isolate) {
  return Private::ForApi(isolate, Text(isolate, "node-compat.global-object"));
}
Local<Value> Item(Local<Array> state, Slot slot) {
  return state->Get(Isolate::GetCurrent()->GetCurrentContext(), slot).ToLocalChecked();
}
void Put(Local<Array> state, Slot slot, Local<Value> value) {
  state->Set(Isolate::GetCurrent()->GetCurrentContext(), slot, value).Check();
}
Local<Object> Storage(Local<Array> state) { return Item(state, kStorage).As<Object>(); }
Local<Context> Owner(Local<Array> state) {
  return Item(state, kReader).As<Function>()->GetCreationContext().ToLocalChecked();
}

void Capture(Local<Name>, const PropertyCallbackInfo<Value>& info) {
  auto state = info.Data().As<Array>();
#if NODE_MAJOR_VERSION >= 26
  // DetachGlobal creates this permanent API proxy for the original global.
  Put(state, kStorage, info.HolderV2());
#else
  // Never expose the hidden JSGlobalObject to JavaScript.
  Put(state, kStorage, info.Holder());
#endif
  Put(state, kCaptured, True(info.GetIsolate()));
}

bool RemoveCapture(Local<Array> state, Local<Context> context) {
  auto name = Item(state, kCaptureName);
  if (name->IsUndefined()) return true;
  if (!Storage(state)->Delete(context, name.As<Name>()).FromMaybe(false)) return false;
  Put(state, kCaptureName, Undefined(Isolate::GetCurrent()));
  return true;
}

bool PrepareCapture(Local<Array> state, Local<Context> context) {
  auto isolate = Isolate::GetCurrent();
  Context::Scope scope(context);
  for (;;) {
    const auto sequence = Item(state, kSequence).As<Uint32>()->Value();
    if (sequence == UINT32_MAX) {
      isolate->ThrowException(Exception::Error(Text(isolate, "Global owner capture names exhausted")));
      return false;
    }
    Put(state, kSequence, Integer::NewFromUnsigned(isolate, sequence + 1));
    const auto identifier = "__nodeCompatGlobalOwner" + std::to_string(sequence);
    auto name = Text(isolate, identifier.c_str());
    auto present = Storage(state)->HasOwnProperty(context, name);
    if (present.IsNothing()) return false;
    if (present.FromJust()) continue;
    if (!Storage(state)->SetNativeDataProperty(context, name, Capture, nullptr, state, DontEnum).FromMaybe(false)) return false;
    Put(state, kCaptureName, name);
    Local<Script> script;
    Local<Value> reader;
    if (!Script::Compile(context, Text(isolate, ("(() => " + identifier + ")").c_str())).ToLocal(&script) ||
        !script->Run(context).ToLocal(&reader)) {
      RemoveCapture(state, context);
      return false;
    }
    Put(state, kReader, reader);
    Put(state, kCaptured, False(isolate));
    // A lexical binding can shadow an absent own property, including in its TDZ.
    // Verify that the native getter ran rather than trusting the generated name.
    bool captured;
    {
      TryCatch caught(isolate);
      Local<Value> ignored;
      captured = reader.As<Function>()->Call(context, Undefined(isolate), 0, nullptr).ToLocal(&ignored) &&
          Item(state, kCaptured)->IsTrue();
      if (!captured) caught.Reset();
    }
    if (captured) return true;
    if (!RemoveCapture(state, context)) return false;
  }
}

Intercepted Describe(Local<Name> key, const PropertyCallbackInfo<Value>& info) {
  auto state = info.Data().As<Array>();
  ReflectionScope scope;
  Local<Value> descriptor;
  if (Storage(state)->GetOwnPropertyDescriptor(Owner(state), key).ToLocal(&descriptor)) {
    if (descriptor->IsUndefined()) return Intercepted::kNo;
    // Descriptor transport must not inherit author-provided fields.
    if (descriptor.As<Object>()->SetPrototypeV2(Owner(state), Null(info.GetIsolate())).IsNothing()) return Intercepted::kYes;
    info.GetReturnValue().Set(descriptor);
  }
  return Intercepted::kYes;
}

Intercepted Query(Local<Name> key, const PropertyCallbackInfo<Integer>& info) {
  auto state = info.Data().As<Array>();
  ReflectionScope scope;
  Local<Value> descriptor;
  auto context = Owner(state);
  if (!Storage(state)->GetOwnPropertyDescriptor(context, key).ToLocal(&descriptor)) return Intercepted::kYes;
  if (descriptor->IsUndefined()) return Intercepted::kNo;
  auto object = descriptor.As<Object>();
  if (object->SetPrototypeV2(context, Null(info.GetIsolate())).IsNothing()) return Intercepted::kYes;
  int flags = 0;
  Local<Value> value;
  if (!object->Get(context, Text(info.GetIsolate(), "writable")).ToLocal(&value)) return Intercepted::kYes;
  if (value->IsFalse()) flags |= ReadOnly;
  if (!object->Get(context, Text(info.GetIsolate(), "enumerable")).ToLocal(&value)) return Intercepted::kYes;
  if (value->IsFalse()) flags |= DontEnum;
  if (!object->Get(context, Text(info.GetIsolate(), "configurable")).ToLocal(&value)) return Intercepted::kYes;
  if (value->IsFalse()) flags |= DontDelete;
  info.GetReturnValue().Set(flags);
  return Intercepted::kYes;
}

Intercepted Define(Local<Name> key, const PropertyDescriptor& descriptor, const PropertyCallbackInfo<void>& info) {
  auto state = info.Data().As<Array>();
  std::unique_ptr<PropertyDescriptor> copy;
  if (descriptor.has_get() || descriptor.has_set()) {
    copy = std::make_unique<PropertyDescriptor>(
        descriptor.has_get() ? descriptor.get() : Local<Value>(),
        descriptor.has_set() ? descriptor.set() : Local<Value>());
  } else if (descriptor.has_writable()) {
    copy = std::make_unique<PropertyDescriptor>(
        descriptor.has_value() ? descriptor.value() : Local<Value>(), descriptor.writable());
  } else if (descriptor.has_value()) copy = std::make_unique<PropertyDescriptor>(descriptor.value());
  else copy = std::make_unique<PropertyDescriptor>();
  if (descriptor.has_enumerable()) copy->set_enumerable(descriptor.enumerable());
  if (descriptor.has_configurable()) copy->set_configurable(descriptor.configurable());
  ReflectionScope scope;
  auto result = Storage(state)->DefineProperty(Owner(state), key, *copy);
  if (result.IsJust() && !result.FromJust()) info.GetReturnValue().SetFalse();
  return Intercepted::kYes;
}

Intercepted Delete(Local<Name> key, const PropertyCallbackInfo<Boolean>& info) {
  auto state = info.Data().As<Array>();
  ReflectionScope scope;
  auto result = Storage(state)->Delete(Owner(state), key);
  if (result.IsJust()) info.GetReturnValue().Set(result.FromJust());
  return Intercepted::kYes;
}

void Enumerate(const PropertyCallbackInfo<Array>& info, bool indices) {
  auto state = info.Data().As<Array>();
  ReflectionScope scope;
  auto context = Owner(state);
  Local<Array> keys;
  if (!Storage(state)->GetOwnPropertyNames(context, ALL_PROPERTIES, KeyConversionMode::kKeepNumbers).ToLocal(&keys)) return;
  auto result = Array::New(info.GetIsolate());
  uint32_t next = 0;
  for (uint32_t i = 0; i < keys->Length(); ++i) {
    auto key = keys->Get(context, i).ToLocalChecked();
    if (key->IsUint32() == indices) result->Set(context, next++, key).Check();
  }
  info.GetReturnValue().Set(result);
}
Local<String> Index(Isolate* isolate, uint32_t index) {
  return Text(isolate, std::to_string(index).c_str());
}
Intercepted DescribeIndex(uint32_t key, const PropertyCallbackInfo<Value>& info) { return Describe(Index(info.GetIsolate(), key), info); }
Intercepted QueryIndex(uint32_t key, const PropertyCallbackInfo<Integer>& info) { return Query(Index(info.GetIsolate(), key), info); }
Intercepted DefineIndex(uint32_t key, const PropertyDescriptor& value, const PropertyCallbackInfo<void>& info) { return Define(Index(info.GetIsolate(), key), value, info); }
Intercepted DeleteIndex(uint32_t key, const PropertyCallbackInfo<Boolean>& info) { return Delete(Index(info.GetIsolate(), key), info); }
void NamedKeys(const PropertyCallbackInfo<Array>& info) { Enumerate(info, false); }
void IndexedKeys(const PropertyCallbackInfo<Array>& info) { Enumerate(info, true); }
}  // namespace

MaybeLocal<Object> CreateGlobalObject(Local<Context> context) {
  auto isolate = Isolate::GetCurrent();
  Context::Scope scope(context);
  Local<Value> values[] = {context->Global(), Undefined(isolate), Undefined(isolate), False(isolate), Integer::New(isolate, 0)};
  auto state = Array::New(isolate, values, 5);
  if (!PrepareCapture(state, context) || !RemoveCapture(state, context)) return {};
  auto constructor_template = FunctionTemplate::New(isolate);
  auto instance = constructor_template->InstanceTemplate();
  instance->SetImmutableProto();
  instance->SetHandler(NamedPropertyHandlerConfiguration(nullptr, nullptr, Query, Delete, NamedKeys, Define, Describe, state));
  instance->SetHandler(IndexedPropertyHandlerConfiguration(nullptr, nullptr, QueryIndex, DeleteIndex, IndexedKeys, DefineIndex, DescribeIndex, state));
  auto constructor = constructor_template->GetFunction(context).ToLocalChecked();
  if (constructor->Set(context, Text(isolate, "prototype"), context->Global()->GetPrototypeV2()).IsNothing()) return {};
  Local<Object> view;
  if (!constructor->NewInstance(context).ToLocal(&view)) return {};
  if (context->GetExtrasBindingObject()->SetPrivate(context, StateKey(isolate), state).IsNothing()) return {};
  return view;
}

bool PrepareGlobalObjectDetach(Local<Context> context) {
  Local<Value> state;
  if (!context->GetExtrasBindingObject()->GetPrivate(context, StateKey(Isolate::GetCurrent())).ToLocal(&state)) return false;
  return state->IsUndefined() || PrepareCapture(state.As<Array>(), context);
}

bool FinishGlobalObjectDetach(Local<Context> context) {
  auto isolate = Isolate::GetCurrent();
  Context::Scope scope(context);
  Local<Value> value;
  if (!context->GetExtrasBindingObject()->GetPrivate(context, StateKey(isolate)).ToLocal(&value)) return false;
  if (value->IsUndefined()) return true;
  auto state = value.As<Array>();
  Put(state, kCaptured, False(isolate));
  Local<Value> ignored;
  if (!Item(state, kReader).As<Function>()->Call(context, Undefined(isolate), 0, nullptr).ToLocal(&ignored)) return false;
  if (!Item(state, kCaptured)->IsTrue()) {
    isolate->ThrowException(Exception::Error(Text(isolate, "Original global capture did not run")));
    return false;
  }
  return RemoveCapture(state, context);
}

bool IsGlobalObjectReflection() { return reflection_depth != 0; }
}  // namespace node_compat
