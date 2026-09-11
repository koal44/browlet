#include <node.h>
#include "vm.h"
#include "host-hooks.h"
#include "property-delegate.h"

#include <memory>
#include <unordered_set>
#include <unordered_map>
#include <string>
#include <vector>

namespace node_compat {
namespace {
using namespace v8;

class NativeHandle;
struct AddonData {
  node::Environment* environment;
  Global<FunctionTemplate> queue_type;
  Global<FunctionTemplate> context_type;
  Global<ObjectTemplate> global_template;
  std::unordered_map<std::string, Global<ObjectTemplate>> prototype_templates;
  Global<Private> lifetime_key;
  Global<Private> queue_key;
  Global<Private> context_key;
  std::unordered_set<NativeHandle*> handles;
};

class NativeHandle {
 public:
  NativeHandle(AddonData* owner, Local<Object> holder, Local<Private> brand)
      : owner(owner) {
    owner->handles.insert(this);
    auto isolate = Isolate::GetCurrent();
    holder->SetPrivate(isolate->GetCurrentContext(), brand,
        External::New(isolate, this)).Check();
    persistent.Reset(isolate, holder);
    persistent.SetWeak(this, [](const WeakCallbackInfo<NativeHandle>& info) {
      info.GetParameter()->persistent.Reset();
      // Queue destruction can touch V8's queue list. Wait until the second
      // pass, when V8 permits work beyond resetting this weak handle.
      info.SetSecondPassCallback([](const WeakCallbackInfo<NativeHandle>& next) {
        delete next.GetParameter();
      });
    }, WeakCallbackType::kParameter);
  }
  virtual ~NativeHandle() { owner->handles.erase(this); }
 private:
  AddonData* owner;
  Global<Object> persistent;
};

class Queue : public NativeHandle {
 public:
  Queue(AddonData* owner, Local<Object> holder, Isolate* isolate)
      : NativeHandle(owner, holder, owner->queue_key.Get(isolate)),
        queue(MicrotaskQueue::New(isolate, MicrotasksPolicy::kExplicit)) {}
  std::shared_ptr<MicrotaskQueue> queue;
};

class ContextHandle : public NativeHandle {
 public:
  enum State { kAttached, kDetached, kTransferred };
  ContextHandle(AddonData* owner, Local<Object> holder, Local<Context> realm,
                std::shared_ptr<MicrotaskQueue> queue, Local<ObjectTemplate> global_template)
      : NativeHandle(owner, holder, owner->context_key.Get(Isolate::GetCurrent())),
        queue(std::move(queue)) {
    auto isolate = Isolate::GetCurrent();
    context.Reset(isolate, realm);
    this->global_template.Reset(isolate, global_template);
    // The JS holder and the realm's intrinsic Object.prototype retain each
    // other. A strong native Context reference would make that cycle immortal.
    context.SetWeak();
  }
  Global<Context> context;
  Global<ObjectTemplate> global_template;
  std::shared_ptr<MicrotaskQueue> queue;
  State state = kAttached;
};

Local<String> Text(Isolate* isolate, const char* text) {
  return String::NewFromUtf8(isolate, text).ToLocalChecked();
}

void Fail(Isolate* isolate, const char* code, const char* message) {
  auto error = Exception::TypeError(Text(isolate, message)).As<Object>();
  if (error->Set(isolate->GetCurrentContext(), Text(isolate, "code"),
                 Text(isolate, code)).IsNothing()) return;
  isolate->ThrowException(error);
}

AddonData* Data(const FunctionCallbackInfo<Value>& args) {
  return static_cast<AddonData*>(args.Data().As<External>()->Value());
}

void IllegalConstructor(const FunctionCallbackInfo<Value>& args) {
  Fail(args.GetIsolate(), "ERR_ILLEGAL_CONSTRUCTOR", "Use the node-compat factory");
}

template <class T>
T* Unwrap(Isolate* isolate, Local<Value> value,
          const Global<Private>& key) {
  Local<Value> pointer;
  if (!value->IsObject() ||
      !value.As<Object>()->GetPrivate(isolate->GetCurrentContext(), key.Get(isolate))
           .ToLocal(&pointer) || !pointer->IsExternal()) {
    Fail(isolate, "ERR_INVALID_ARG_TYPE", "Invalid node-compat native handle");
    return nullptr;
  }
  return static_cast<T*>(static_cast<NativeHandle*>(pointer.As<External>()->Value()));
}

void CreateQueue(const FunctionCallbackInfo<Value>& args) {
  auto isolate = args.GetIsolate();
  Local<Object> holder;
  if (!Data(args)->queue_type.Get(isolate)->InstanceTemplate()
           ->NewInstance(isolate->GetCurrentContext()).ToLocal(&holder)) return;
  new Queue(Data(args), holder, isolate);
  args.GetReturnValue().Set(holder);
}

void Enqueue(const FunctionCallbackInfo<Value>& args) {
  auto isolate = args.GetIsolate();
  auto queue = Unwrap<Queue>(isolate, args.This(), Data(args)->queue_key);
  if (!queue) return;
  if (!args[0]->IsFunction()) {
    Fail(isolate, "ERR_INVALID_ARG_TYPE", "Microtask must be a function");
    return;
  }
  queue->queue->EnqueueMicrotask(isolate, args[0].As<Function>());
}

void Checkpoint(const FunctionCallbackInfo<Value>& args) {
  auto isolate = args.GetIsolate();
  auto queue = Unwrap<Queue>(isolate, args.This(), Data(args)->queue_key);
  if (queue) queue->queue->PerformCheckpoint(isolate);
}

void CreateContext(const FunctionCallbackInfo<Value>& args) {
  auto isolate = args.GetIsolate();
  auto data = Data(args);
  auto host = isolate->GetCurrentContext();
  std::shared_ptr<MicrotaskQueue> queue;
  if (!args[0]->IsUndefined()) {
    auto owner = Unwrap<Queue>(isolate, args[0], data->queue_key);
    if (!owner) return;
    queue = owner->queue;
  }
  ContextHandle* previous = nullptr;
  Local<Value> proxy;
  if (!args[1]->IsUndefined()) {
    previous = Unwrap<ContextHandle>(isolate, args[1], data->context_key);
    if (!previous) return;
    if (previous->state != ContextHandle::kDetached) {
      Fail(isolate, "ERR_INVALID_ARG_VALUE", "Reuse requires a detached context handle");
      return;
    }
    if (!args[1].As<Object>()->Get(host, Text(isolate, "globalProxy"))
             .ToLocal(&proxy)) return;
  }

  auto global_template = data->global_template.Get(isolate);
  std::vector<int> prototype_kinds;
  if (!args[2]->IsUndefined()) {
    if (!args[2]->IsArray()) {
      Fail(isolate, "ERR_INVALID_ARG_TYPE", "Expected a prototype layout array");
      return;
    }
    auto layout = args[2].As<Array>();
    if (layout->Length() == 0) {
      Fail(isolate, "ERR_INVALID_ARG_VALUE", "Global prototype layout must not be empty");
      return;
    }
    std::string key;
    for (uint32_t i = 0; i < layout->Length(); ++i) {
      Local<Value> kind;
      if (!layout->Get(host, i).ToLocal(&kind)) return;
      if (!kind->IsInt32() || kind.As<Int32>()->Value() < 0 || kind.As<Int32>()->Value() > 2) {
        Fail(isolate, "ERR_INVALID_ARG_VALUE", "Unknown prototype layout kind");
        return;
      }
      prototype_kinds.push_back(kind.As<Int32>()->Value());
      key += static_cast<char>('0' + prototype_kinds.back());
    }
    auto found = data->prototype_templates.find(key);
    if (found == data->prototype_templates.end()) {
      Local<FunctionTemplate> parent;
      for (auto kind = prototype_kinds.rbegin(); kind != prototype_kinds.rend(); ++kind) {
        auto constructor = FunctionTemplate::New(isolate);
        if (!parent.IsEmpty()) constructor->Inherit(parent);
        if (*kind != 0) constructor->PrototypeTemplate()->SetImmutableProto();
        if (*kind == 2) ConfigurePropertyDelegate(isolate, constructor->PrototypeTemplate());
        parent = constructor;
      }
      global_template = parent->InstanceTemplate();
      global_template->SetImmutableProto();
      ConfigurePropertyDelegate(isolate, global_template, true);
      data->prototype_templates.emplace(key, Global<ObjectTemplate>(isolate, global_template));
    } else {
      global_template = found->second.Get(isolate);
    }
  }
  if (previous && previous->global_template.Get(isolate) != global_template) {
    Fail(isolate, "ERR_INVALID_ARG_VALUE", "Reuse requires the same global prototype layout");
    return;
  }
  auto realm = Context::New(isolate, nullptr, global_template,
                            proxy, {}, queue.get());
  if (realm.IsEmpty()) return;
  if (node::InitializeContext(realm).IsNothing()) return;
  node::RegisterContext(data->environment, realm, "node-compat");
  realm->SetSecurityToken(host->GetSecurityToken());

  Local<Object> holder;
  if (!data->context_type.Get(isolate)->InstanceTemplate()
           ->NewInstance(host).ToLocal(&holder)) return;
  new ContextHandle(data, holder, realm, std::move(queue), global_template);
  holder->DefineOwnProperty(host, Text(isolate, "realm"), GetRealmReference(realm),
      static_cast<PropertyAttribute>(ReadOnly | DontDelete)).Check();
  if (!args[2]->IsUndefined()) {
    InitializePropertyDelegate(realm, realm->Global(), true);
    // Allocate a distinct, realm-owned global target with the same observable
    // prototype as the global proxy. The JS binding owns its association with
    // the implementation; the proxy can later move to another context.
    Context::Scope scope(realm);
    auto object_constructor_template = FunctionTemplate::New(isolate);
    object_constructor_template->InstanceTemplate()->SetImmutableProto();
    auto constructor = object_constructor_template->GetFunction(realm).ToLocalChecked();
    constructor->Set(realm, Text(isolate, "prototype"), realm->Global()->GetPrototypeV2()).Check();
    auto object = constructor->NewInstance(realm).ToLocalChecked();
    holder->DefineOwnProperty(host, Text(isolate, "globalObject"), object,
        static_cast<PropertyAttribute>(ReadOnly | DontDelete)).Check();
    auto chain = Array::New(isolate, static_cast<int>(prototype_kinds.size()));
    auto prototype = realm->Global()->GetPrototypeV2();
    for (uint32_t i = 0; i < prototype_kinds.size(); ++i) {
      // FunctionTemplate supplies a constructor property even for layers such
      // as WindowProperties. Bindings install the actual interface constructors.
      if (prototype.As<Object>()->Delete(realm, Text(isolate, "constructor")).IsNothing()) return;
      if (prototype_kinds[i] == 2) InitializePropertyDelegate(realm, prototype.As<Object>());
      chain->Set(host, i, prototype).Check();
      prototype = prototype.As<Object>()->GetPrototypeV2();
    }
    holder->DefineOwnProperty(host, Text(isolate, "prototypeChain"), chain,
        static_cast<PropertyAttribute>(ReadOnly | DontDelete)).Check();
  }
  if (holder->DefineOwnProperty(host, Text(isolate, "globalProxy"),
                                realm->Global(),
                                static_cast<PropertyAttribute>(ReadOnly | DontDelete))
          .IsNothing()) return;
  {
    Context::Scope scope(realm);
    Local<Value> constructor;
    Local<Value> prototype;
    if (!realm->Global()->Get(realm, Text(isolate, "Object")).ToLocal(&constructor) ||
        !constructor.As<Object>()->Get(realm, Text(isolate, "prototype"))
             .ToLocal(&prototype)) return;
    // Every live Context retains this intrinsic, including when only a
    // Promise or closure is reachable. This preserves the original lifetime fix.
    if (prototype.As<Object>()->SetPrivate(
            realm, data->lifetime_key.Get(isolate), holder).IsNothing()) return;
  }
  if (previous) previous->state = ContextHandle::kTransferred;
  args.GetReturnValue().Set(holder);
}

void Detach(const FunctionCallbackInfo<Value>& args) {
  auto isolate = args.GetIsolate();
  auto handle = Unwrap<ContextHandle>(isolate, args.This(), Data(args)->context_key);
  if (!handle) return;
  if (handle->state != ContextHandle::kAttached || handle->context.IsEmpty()) {
    Fail(isolate, "ERR_INVALID_STATE", "Context handle is detached");
    return;
  }
  auto realm = handle->context.Get(isolate);
  auto proxy = realm->Global();
  realm->DetachGlobal();
  handle->state = ContextHandle::kDetached;
  args.GetReturnValue().Set(proxy);
}

void Evaluate(const FunctionCallbackInfo<Value>& args) {
  auto isolate = args.GetIsolate();
  auto handle = Unwrap<ContextHandle>(isolate, args[1], Data(args)->context_key);
  if (!handle) return;
  if (handle->state != ContextHandle::kAttached || handle->context.IsEmpty()) {
    Fail(isolate, "ERR_CONTEXT_NOT_INITIALIZED", "Context handle is detached");
    return;
  }
  if (!args[0]->IsString() || !args[2]->IsString() || !args[3]->IsInt32()) {
    Fail(isolate, "ERR_INVALID_ARG_TYPE", "Expected source, filename and line offset");
    return;
  }
  auto realm = handle->context.Get(isolate);
  Context::Scope scope(realm);
  ScriptOrigin origin(args[2], args[3].As<Int32>()->Value());
  Local<Script> script;
  Local<Value> result;
  if (!Script::Compile(realm, args[0].As<String>(), &origin).ToLocal(&script) ||
      !script->Run(realm).ToLocal(&result)) return;
  args.GetReturnValue().Set(result);
}

#ifdef NODE_COMPAT_COLLECTION_ITERATORS
void CreateCollectionIterator(const FunctionCallbackInfo<Value>& args) {
  auto isolate = args.GetIsolate();
  auto handle = Unwrap<ContextHandle>(isolate, args[0], Data(args)->context_key);
  if (!handle) return;
  if (handle->state != ContextHandle::kAttached || handle->context.IsEmpty()) {
    Fail(isolate, "ERR_CONTEXT_NOT_INITIALIZED", "Context handle is detached");
    return;
  }
  CollectionIterator::Kind kind;
  if (args[1]->StrictEquals(Text(isolate, "map"))) {
    kind = CollectionIterator::Kind::kMap;
  } else if (args[1]->StrictEquals(Text(isolate, "set"))) {
    kind = CollectionIterator::Kind::kSet;
  } else {
    Fail(isolate, "ERR_INVALID_ARG_VALUE", "Iterator kind must be map or set");
    return;
  }
  if (!args[2]->IsFunction()) {
    Fail(isolate, "ERR_INVALID_ARG_TYPE", "Iterator steps must be a function");
    return;
  }
  auto realm = handle->context.Get(isolate);
  Context::Scope scope(realm);
  Local<Object> iterator;
  if (CollectionIterator::New(realm, kind, args[2].As<Function>())
          .ToLocal(&iterator)) {
    args.GetReturnValue().Set(iterator);
  }
}
#endif

void IsContext(const FunctionCallbackInfo<Value>& args) {
  auto isolate = args.GetIsolate();
  Local<Value> pointer;
  if (!args[0]->IsObject() ||
      !args[0].As<Object>()->GetPrivate(isolate->GetCurrentContext(),
          Data(args)->context_key.Get(isolate)).ToLocal(&pointer) ||
      !pointer->IsExternal()) {
    args.GetReturnValue().Set(false);
    return;
  }
  auto handle = static_cast<ContextHandle*>(
      static_cast<NativeHandle*>(pointer.As<External>()->Value()));
  args.GetReturnValue().Set(handle && handle->state == ContextHandle::kAttached &&
                            !handle->context.IsEmpty());
}

}  // namespace

void InitializeVm(v8::Local<v8::Object> exports, v8::Local<v8::Context> context) {
  using namespace v8;
  auto isolate = Isolate::GetCurrent();
  auto data = new AddonData{node::GetCurrentEnvironment(context)};
  node::AddEnvironmentCleanupHook(isolate, [](void* pointer) {
    auto data = static_cast<AddonData*>(pointer);
    while (!data->handles.empty()) delete *data->handles.begin();
    delete data;
  }, data);
  auto external = External::New(isolate, data);
  auto queue_type = FunctionTemplate::New(isolate, IllegalConstructor);
  queue_type->SetClassName(Text(isolate, "MicrotaskQueue"));
  queue_type->PrototypeTemplate()->Set(isolate, "enqueueMicrotask",
      FunctionTemplate::New(isolate, Enqueue, external));
  queue_type->PrototypeTemplate()->Set(isolate, "runMicrotasks",
      FunctionTemplate::New(isolate, Checkpoint, external));
  data->queue_type.Reset(isolate, queue_type);

  auto context_type = FunctionTemplate::New(isolate, IllegalConstructor);
  context_type->SetClassName(Text(isolate, "ContextHandle"));
  context_type->PrototypeTemplate()->Set(isolate, "detachGlobal",
      FunctionTemplate::New(isolate, Detach, external));
  data->context_type.Reset(isolate, context_type);
  data->global_template.Reset(isolate, ObjectTemplate::New(isolate));
  data->lifetime_key.Reset(isolate, Private::New(isolate));
  data->queue_key.Reset(isolate, Private::New(isolate));
  data->context_key.Reset(isolate, Private::New(isolate));

  const struct { const char* name; FunctionCallback callback; } methods[] = {
    {"createMicrotaskQueue", CreateQueue},
    {"createContextHandle", CreateContext},
#ifdef NODE_COMPAT_COLLECTION_ITERATORS
    {"createCollectionIterator", CreateCollectionIterator},
#endif
    {"evaluate", Evaluate},
    {"isContext", IsContext},
    {"setPropertyDelegate", SetPropertyDelegate},
  };
  for (const auto& method : methods) {
    Local<Function> function;
    if (!Function::New(context, method.callback, external).ToLocal(&function) ||
        exports->Set(context, Text(isolate, method.name), function).IsNothing()) return;
  }
}

}  // namespace node_compat
