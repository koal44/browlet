#include <node.h>
#include "global-access.h"
#include "vm.h"
#include "vm-imports.h"
#include "realm.h"
#include "property-delegate.h"
#include "global-object.h"

#include <memory>
#include <unordered_set>
#include <unordered_map>
#include <string>
#include <vector>

namespace node_compat {
namespace {
using namespace v8;

class NativeHandle;
class Queue;
// Non-owning entries; Queue destruction removes them before its engine queue dies.
thread_local std::unordered_map<Isolate*, std::unordered_map<MicrotaskQueue*, Queue*>> observed_queues;
void NotifyCallCompleted(Isolate* isolate);

struct AddonData {
  node::Environment* environment;
  Global<FunctionTemplate> queue_type;
  Global<FunctionTemplate> context_type;
  Global<ObjectTemplate> global_template;
  std::unordered_map<std::string, Global<ObjectTemplate>> prototype_templates;
  Global<Private> lifetime_key;
  Global<Private> queue_key;
  Global<Private> context_key;
  Global<Private> script_key;
  Global<ObjectTemplate> script_template;
  std::unordered_set<NativeHandle*> handles;
  bool observing_promise_settlements = false;
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
      auto handle = info.GetParameter();
      handle->persistent.Reset();
      // The second pass now owns deletion, even if environment cleanup runs first.
      handle->owner->handles.erase(handle);
      handle->owner = nullptr;
      // Queue destruction can touch V8's queue list. Wait until the second
      // pass, when V8 permits work beyond resetting this weak handle.
      info.SetSecondPassCallback([](const WeakCallbackInfo<NativeHandle>& next) {
        delete next.GetParameter();
      });
    }, WeakCallbackType::kParameter);
  }
  virtual ~NativeHandle() {
    if (owner) owner->handles.erase(this);
  }
 private:
  AddonData* owner;
  Global<Object> persistent;
};

class Queue : public NativeHandle {
 public:
  Isolate* isolate;
  std::shared_ptr<MicrotaskQueue> queue;
  Global<Function> notify;
  bool checkpoint_requested = false;

  Queue(AddonData* owner, Local<Object> holder, Isolate* isolate, Local<Value> callback)
      : NativeHandle(owner, holder, owner->queue_key.Get(isolate)),
        isolate(isolate), queue(MicrotaskQueue::New(isolate, MicrotasksPolicy::kExplicit)) {
    if (!callback->IsFunction()) return;
    // Keep the callback in the traced JS graph, not a persistent native root.
    holder->SetPrivate(isolate->GetCurrentContext(), owner->lifetime_key.Get(isolate), callback).Check();
    notify.Reset(isolate, callback.As<Function>());
    notify.SetWeak();
    auto& queues = observed_queues[isolate];
    if (queues.empty()) isolate->AddCallCompletedCallback(NotifyCallCompleted);
    queues.emplace(queue.get(), this);
  }

  ~Queue() override {
    auto entry = observed_queues.find(isolate);
    if (entry == observed_queues.end()) return;
    entry->second.erase(queue.get());
    if (entry->second.empty()) {
      isolate->RemoveCallCompletedCallback(NotifyCallCompleted);
      observed_queues.erase(entry);
    }
  }
};

// Signals request a checkpoint; they must not drain the queue or run author
// code here. In particular, a settlement hook runs before reactions are queued.
void NotifyCheckpoint(Isolate* isolate, Local<Context> context) {
  auto queues = observed_queues.find(isolate);
  if (queues == observed_queues.end()) return;
  if (context.IsEmpty()) return;
  auto entry = queues->second.find(context->GetMicrotaskQueue());
  if (entry == queues->second.end()) return;
  auto queue = entry->second;
  if (queue->checkpoint_requested || queue->queue->IsRunningMicrotasks() || queue->notify.IsEmpty()) return;
  queue->checkpoint_requested = true;
  auto callback = queue->notify.Get(isolate);
  TryCatch caught(isolate);
  if (callback->Call(callback->GetCreationContext().ToLocalChecked(),
                     Undefined(isolate), 0, nullptr).IsEmpty()) {
    if (caught.HasTerminated()) caught.ReThrow();
    else node::FatalException(isolate, caught);
  }
}

// An outer engine call may have queued work without an enqueue hook, e.g.
// FinalizationRegistry cleanup. It need not settle a Promise in this context.
void NotifyCallCompleted(Isolate* isolate) {
  HandleScope handles(isolate);
  NotifyCheckpoint(isolate, isolate->GetCurrentContext());
}

// Internal resolutions such as Atomics.waitAsync need not complete a public
// V8 API call. Use the Promise's owner even when its resolver runs from Node.
void NotifyPromiseSettled(const FunctionCallbackInfo<Value>& args) {
  Local<Context> context;
  if (args[0].As<Promise>()->GetCreationContext().ToLocal(&context)) {
    NotifyCheckpoint(args.GetIsolate(), context);
  }
}

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
  auto data = Data(args);
  if (!args[0]->IsUndefined() && !args[0]->IsFunction()) {
    Fail(isolate, "ERR_INVALID_ARG_TYPE", "Expected a checkpoint notification callback or undefined");
    return;
  }
  if (args[0]->IsFunction() && !data->observing_promise_settlements) {
    // The adapter supplies Node's public hook multiplexer. Do not replace
    // Node/async_hooks' isolate or context hooks. Node owns this observer for
    // its environment's lifetime; it retains no queue or context registration.
    if (!args[1]->IsFunction()) {
      Fail(isolate, "ERR_INVALID_ARG_TYPE", "Expected the Node Promise hook registrar");
      return;
    }
    auto host = isolate->GetCurrentContext();
    Local<Value> observer = Function::New(host, NotifyPromiseSettled).ToLocalChecked();
    if (args[1].As<Function>()->Call(host, Undefined(isolate), 1, &observer).IsEmpty()) return;
    data->observing_promise_settlements = true;
  }
  Local<Object> holder;
  if (!data->queue_type.Get(isolate)->InstanceTemplate()
           ->NewInstance(isolate->GetCurrentContext()).ToLocal(&holder)) return;
  new Queue(data, holder, isolate, args[0]);
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
  if (queue) {
    queue->queue->PerformCheckpoint(isolate);
    // Clear after draining so completion of the checkpoint cannot wake itself.
    queue->checkpoint_requested = false;
  }
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
  const bool global_access = args[3]->IsTrue();
  if ((!args[3]->IsUndefined() && !args[3]->IsBoolean()) || (global_access && args[2]->IsUndefined())) {
    Fail(isolate, "ERR_INVALID_ARG_VALUE", "Global access checks require a prototype layout and boolean option");
    return;
  }
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
    std::string key = global_access ? "guarded:" : "";
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
      if (global_access) ConfigureGlobalAccess(isolate, global_template);
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
  // Guarded globals keep distinct tokens so cross-context access reaches the host policy.
  if (global_access) PrepareGlobalAccess(realm);
  else realm->SetSecurityToken(host->GetSecurityToken());

  Local<Object> holder;
  if (!data->context_type.Get(isolate)->InstanceTemplate()
           ->NewInstance(host).ToLocal(&holder)) return;
  new ContextHandle(data, holder, realm, std::move(queue), global_template);
  // A retained context also retains its queue's notification registration.
  // Intrinsic -> context holder -> queue holder -> callback is collectable.
  holder->SetPrivate(host, data->lifetime_key.Get(isolate), args[0]).Check();
  holder->DefineOwnProperty(host, Text(isolate, "realm"), GetRealmReference(realm),
      static_cast<PropertyAttribute>(ReadOnly | DontDelete)).Check();
  if (!args[2]->IsUndefined()) {
    InitializePropertyDelegate(realm, realm->Global(), true);
    Local<Object> object;
    if (!CreateGlobalObject(realm).ToLocal(&object)) return;
    // The JS adapter adds exact-receiver get/set traps before freezing this slot.
    holder->DefineOwnProperty(host, Text(isolate, "globalObject"), object, ReadOnly).Check();
    Context::Scope scope(realm);
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
  if (!PrepareGlobalObjectDetach(realm)) return;
  auto security_token = realm->GetSecurityToken();
  realm->DetachGlobal();
  // Detachment can replace the embedder token. Retained functions must still
  // access a reused proxy under the context's original engine access policy.
  // HTML origin checks remain the binding's responsibility.
  realm->SetSecurityToken(security_token);
  handle->state = ContextHandle::kDetached;
  if (!FinishGlobalObjectDetach(realm)) return;
  args.GetReturnValue().Set(proxy);
}

void CompileScript(const FunctionCallbackInfo<Value>& args) {
  auto isolate = args.GetIsolate();
  auto realm = isolate->GetCurrentContext();
  if (!args[1]->IsUndefined() && !GetContext(args, args[1]).ToLocal(&realm)) return;
  if (!args[0]->IsString() || !args[2]->IsString() || !args[3]->IsInt32()) {
    Fail(isolate, "ERR_INVALID_ARG_TYPE", "Expected source, filename and line offset");
    return;
  }
  Local<UnboundScript> compiled;
  {
    // Syntax errors belong to the supplied realm. The unbound result can
    // subsequently execute in any attached context in this isolate.
    Context::Scope scope(realm);
    Local<v8::Data> import_options;
    if (!CompilationOptions(isolate, args[4], args[5]->IsTrue()).ToLocal(&import_options)) return;
    ScriptOrigin origin(args[2], args[3].As<Int32>()->Value(), 0,
                        false, -1, {}, false, false, false, import_options);
    ScriptCompiler::Source source(args[0].As<String>(), origin);
    if (!ScriptCompiler::CompileUnboundScript(isolate, &source).ToLocal(&compiled)) return;
  }
  // V8 traces the artifact through its holder, without a strong native root.
  // Allocating the holder in the caller also avoids retaining the compile realm.
  auto host = isolate->GetCurrentContext();
  Local<Object> holder;
  if (!Data(args)->script_template.Get(isolate)->NewInstance(host).ToLocal(&holder)) return;
  holder->SetInternalField(0, compiled);
  if (holder->SetPrivate(host, Data(args)->script_key.Get(isolate), True(isolate)).IsNothing()) return;
  args.GetReturnValue().Set(holder);
}

void InitializeVmRegistry(const FunctionCallbackInfo<Value>& args) {
  auto isolate = args.GetIsolate();
  if (!args[0]->IsObject()) {
    Fail(isolate, "ERR_INVALID_ARG_TYPE", "Expected a VM compilation registry");
    return;
  }
  auto host = node::GetMainContext(node::GetCurrentEnvironment(isolate->GetCurrentContext()));
  auto key = Private::ForApi(isolate, Text(isolate, "browlet.vmRegistry"));
  auto extras = host->GetExtrasBindingObject();
  Local<Value> registry;
  if (!extras->GetPrivate(host, key).ToLocal(&registry)) return;
  if (registry->IsUndefined()) {
    registry = args[0];
    if (extras->SetPrivate(host, key, registry).IsNothing()) return;
  }
  args.GetReturnValue().Set(registry);
}

void RunScript(const FunctionCallbackInfo<Value>& args) {
  auto isolate = args.GetIsolate();
  Local<Value> brand;
  if (!args[0]->IsObject() || !args[0].As<Object>()->GetPrivate(isolate->GetCurrentContext(),
          Data(args)->script_key.Get(isolate)).ToLocal(&brand) || !brand->IsTrue()) {
    Fail(isolate, "ERR_INVALID_ARG_TYPE", "Expected a compiled script handle");
    return;
  }
  auto compiled = args[0].As<Object>()->GetInternalField(0).As<UnboundScript>();
  Local<Context> realm;
  if (!GetContext(args, args[1]).ToLocal(&realm)) return;
  Context::Scope scope(realm);
  Local<Value> result;
  if (!compiled->BindToCurrentContext()->Run(realm).ToLocal(&result)) return;
  args.GetReturnValue().Set(result);
}

void Evaluate(const FunctionCallbackInfo<Value>& args) {
  auto isolate = args.GetIsolate();
  Local<Context> realm;
  if (!GetContext(args, args[1]).ToLocal(&realm)) return;
  if (!args[0]->IsString() || !args[2]->IsString() || !args[3]->IsInt32()) {
    Fail(isolate, "ERR_INVALID_ARG_TYPE", "Expected source, filename and line offset");
    return;
  }
  Context::Scope scope(realm);
  ScriptOrigin origin(args[2], args[3].As<Int32>()->Value());
  Local<Script> script;
  Local<Value> result;
  if (!Script::Compile(realm, args[0].As<String>(), &origin).ToLocal(&script) ||
      !script->Run(realm).ToLocal(&result)) return;
  args.GetReturnValue().Set(result);
}

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

v8::Local<v8::External> InitializeVm(v8::Local<v8::Object> exports,
                                   v8::Local<v8::Context> context) {
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
  data->script_key.Reset(isolate, Private::New(isolate));
  auto script_template = ObjectTemplate::New(isolate);
  script_template->SetInternalFieldCount(1);
  data->script_template.Reset(isolate, script_template);

  const struct { const char* name; FunctionCallback callback; } methods[] = {
    {"initializeVmRegistry", InitializeVmRegistry},
    {"createMicrotaskQueue", CreateQueue},
    {"createContextHandle", CreateContext},
    {"evaluate", Evaluate},
    {"compileScript", CompileScript},
    {"runScript", RunScript},
    {"isContext", IsContext},
    {"setPropertyDelegate", SetPropertyDelegate},
  };
  for (const auto& method : methods) {
    Local<Function> function;
    if (!Function::New(context, method.callback, external).ToLocal(&function) ||
        exports->Set(context, Text(isolate, method.name), function).IsNothing()) return {};
  }
  return external;
}

v8::MaybeLocal<v8::Context> GetContext(
    const v8::FunctionCallbackInfo<v8::Value>& args, v8::Local<v8::Value> value) {
  return GetContext(args, value, args.Data().As<v8::External>());
}

v8::MaybeLocal<v8::Context> GetContext(
    const v8::FunctionCallbackInfo<v8::Value>& args, v8::Local<v8::Value> value,
    v8::Local<v8::External> vm_data) {
  auto isolate = args.GetIsolate();
  auto data = static_cast<AddonData*>(vm_data->Value());
  auto handle = Unwrap<ContextHandle>(isolate, value, data->context_key);
  if (!handle) return {};
  if (handle->state != ContextHandle::kAttached || handle->context.IsEmpty()) {
    Fail(isolate, "ERR_CONTEXT_NOT_INITIALIZED", "Context handle is detached");
    return {};
  }
  return handle->context.Get(isolate);
}

}  // namespace node_compat
