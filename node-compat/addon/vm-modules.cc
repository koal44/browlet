#include <node.h>
#include "vm-modules.h"
#include "vm.h"
#include "vm-imports.h"

#include <unordered_map>
#include <vector>

namespace node_compat {
namespace {
using namespace v8;

struct ModuleData {
  Isolate* isolate;
  Global<External> vm_data;
  Global<Private> module_key;
  Global<ObjectTemplate> module_template;
};

ModuleData* Data(const FunctionCallbackInfo<Value>& args) {
  return static_cast<ModuleData*>(args.Data().As<External>()->Value());
}

Local<String> Text(Isolate* isolate, const char* text) {
  return String::NewFromUtf8(isolate, text).ToLocalChecked();
}

void Fail(Isolate* isolate, const char* code, const char* message) {
  auto error = Exception::TypeError(Text(isolate, message)).As<Object>();
  if (error->Set(isolate->GetCurrentContext(), Text(isolate, "code"),
                 Text(isolate, code)).IsNothing()) return;
  isolate->ThrowException(error);
}

// V8 traces the module and its context through the holder's internal fields;
// no native persistent roots or per-module cleanup callbacks are needed.
enum ModuleField { kCompiledModule, kModuleContext, kSyntheticSteps, kModuleFieldCount };

MaybeLocal<Object> GetModuleHolder(const FunctionCallbackInfo<Value>& args,
                                   Local<Value> value) {
  auto isolate = args.GetIsolate();
  Local<Value> brand;
  if (!value->IsObject() ||
      !value.As<Object>()->GetPrivate(isolate->GetCurrentContext(),
          Data(args)->module_key.Get(isolate)).ToLocal(&brand) || !brand->IsTrue()) {
    Fail(isolate, "ERR_INVALID_ARG_TYPE", "Expected a compiled module handle");
    return {};
  }
  return value.As<Object>();
}

Local<Module> CompiledModule(Local<Object> holder) {
  return holder->GetInternalField(kCompiledModule).As<Module>();
}

MaybeLocal<Object> CreateModuleHolder(const FunctionCallbackInfo<Value>& args,
                                    Local<Module> module) {
  auto isolate = args.GetIsolate();
  auto host = isolate->GetCurrentContext();
  Local<Object> holder;
  if (!Data(args)->module_template.Get(isolate)->NewInstance(host).ToLocal(&holder)) return {};
  holder->SetInternalField(kCompiledModule, module);
  holder->SetInternalField(kModuleContext, args[1]);
  if (holder->SetPrivate(host, Data(args)->module_key.Get(isolate), True(isolate)).IsNothing()) return {};
  return holder;
}

// FixedArray::Get lost its context parameter between our supported V8 bases.
template <class T>
Local<v8::Data> ModuleItem(Local<T> array, Local<Context> context, int index) {
  if constexpr (requires { array->Get(index); }) return array->Get(index);
  else return array->Get(context, index);
}

void CompileModule(const FunctionCallbackInfo<Value>& args) {
  auto isolate = args.GetIsolate();
  Local<Context> realm;
  if (!GetContext(args, args[1], Data(args)->vm_data.Get(isolate)).ToLocal(&realm)) return;
  if (!args[0]->IsString() || !args[2]->IsString() || !args[3]->IsInt32()) {
    Fail(isolate, "ERR_INVALID_ARG_TYPE", "Expected source, filename and line offset");
    return;
  }
  Local<Module> module;
  {
    Context::Scope scope(realm);
    Local<v8::Data> import_options;
    if (!DynamicImportOptions(isolate, args[4]).ToLocal(&import_options)) return;
    ScriptOrigin origin(args[2], args[3].As<Int32>()->Value(), 0,
                        false, -1, {}, false, false, true, import_options);
    ScriptCompiler::Source source(args[0].As<String>(), origin);
    if (!ScriptCompiler::CompileModule(isolate, &source).ToLocal(&module)) return;
  }
  Local<Object> holder;
  if (!CreateModuleHolder(args, module).ToLocal(&holder)) return;
  args.GetReturnValue().Set(holder);
}

#ifdef NODE_COMPAT_IMPORT_META
Local<Private> ImportMetaInitializerKey(Isolate* isolate) {
  return Private::ForApi(isolate, Text(isolate, "browlet.module-records.importMetaInitializer"));
}

void InitializeImportMeta(Local<Context> context, Local<Module> module,
                          Local<Object> meta) {
  auto isolate = Isolate::GetCurrent();
  Local<Value> initializer;
  if (!module->GetModuleNamespace().As<Object>()->GetPrivate(context,
          ImportMetaInitializerKey(isolate)).ToLocal(&initializer)) return;
  if (!initializer->IsFunction()) {
    node::HostInitializeImportMetaObjectCallback(context, module, meta);
    return;
  }
  Local<Value> argument = meta;
  // V8 owns lazy creation, successful caching, and retry after a thrown value.
  if (initializer.As<Function>()->Call(context, Undefined(isolate), 1, &argument).IsEmpty()) return;
}

void SetImportMetaInitializer(const FunctionCallbackInfo<Value>& args) {
  auto isolate = args.GetIsolate();
  Local<Object> holder;
  if (!GetModuleHolder(args, args[0]).ToLocal(&holder)) return;
  auto module = CompiledModule(holder);
  if (module->GetStatus() < Module::kInstantiated) {
    Fail(isolate, "ERR_MODULE_NOT_LINKED", "Link the module before registering its import.meta initializer");
    return;
  }
  if (!args[1]->IsFunction()) {
    Fail(isolate, "ERR_INVALID_ARG_TYPE", "Expected an import.meta initializer");
    return;
  }
  // A private namespace property is traced with the module, without a native
  // registry rooting otherwise discarded callbacks, modules, or contexts.
  if (module->GetModuleNamespace().As<Object>()->SetPrivate(isolate->GetCurrentContext(),
          ImportMetaInitializerKey(isolate), args[1]).IsNothing()) return;
}
#endif

Local<Private> SyntheticStepsKey(Isolate* isolate) {
  return Private::ForApi(isolate, Text(isolate, "browlet.module-records.syntheticSteps"));
}

MaybeLocal<Value> EvaluateSyntheticModule(Local<Context> context, Local<Module> module) {
  auto isolate = Isolate::GetCurrent();
  auto exports = module->GetModuleNamespace().As<Object>();
  Local<Value> callback, ignored;
  if (!exports->GetPrivate(context, SyntheticStepsKey(isolate)).ToLocal(&callback) ||
      exports->DeletePrivate(context, SyntheticStepsKey(isolate)).IsNothing() ||
      !callback.As<Function>()->Call(context, Undefined(isolate), 0, nullptr).ToLocal(&ignored)) return {};
  Local<Promise::Resolver> resolver;
  if (!Promise::Resolver::New(context).ToLocal(&resolver) ||
      resolver->Resolve(context, Undefined(isolate)).IsNothing()) return {};
  return resolver->GetPromise();
}

void CreateSyntheticModule(const FunctionCallbackInfo<Value>& args) {
  auto isolate = args.GetIsolate();
  Local<Context> realm;
  if (!GetContext(args, args[1], Data(args)->vm_data.Get(isolate)).ToLocal(&realm)) return;
  if (!args[0]->IsArray() || !args[2]->IsFunction() || !args[3]->IsString()) {
    Fail(isolate, "ERR_INVALID_ARG_TYPE", "Expected export names, evaluation callback and identifier");
    return;
  }
  auto exports = args[0].As<Array>();
  std::vector<Local<String>> names;
  for (uint32_t i = 0; i < exports->Length(); ++i) {
    Local<Value> name;
    if (!exports->Get(isolate->GetCurrentContext(), i).ToLocal(&name)) return;
    if (!name->IsString()) {
      Fail(isolate, "ERR_INVALID_ARG_TYPE", "Export names must be strings");
      return;
    }
    names.push_back(name.As<String>());
  }
  Local<Module> module;
  {
    Context::Scope scope(realm);
    module = Module::CreateSyntheticModule(isolate, args[3].As<String>(),
        {names.data(), names.size()}, EvaluateSyntheticModule);
  }
  Local<Object> holder;
  if (!CreateModuleHolder(args, module).ToLocal(&holder)) return;
  holder->SetInternalField(kSyntheticSteps, args[2]);
  args.GetReturnValue().Set(holder);
}

void SetSyntheticExport(const FunctionCallbackInfo<Value>& args) {
  auto isolate = args.GetIsolate();
  Local<Object> holder;
  if (!GetModuleHolder(args, args[0]).ToLocal(&holder)) return;
  auto module = CompiledModule(holder);
  if (!module->IsSyntheticModule() || !args[1]->IsString()) {
    Fail(isolate, "ERR_INVALID_ARG_TYPE", "Expected a synthetic module and an export name");
    return;
  }
  Local<Context> realm;
  if (!GetContext(args, holder->GetInternalField(kModuleContext).As<Value>(),
          Data(args)->vm_data.Get(isolate)).ToLocal(&realm)) return;
  Context::Scope scope(realm);
  if (module->SetSyntheticModuleExport(isolate, args[1].As<String>(), args[2]).IsNothing()) return;
}

bool LinkSyntheticModule(Local<Context> context, Local<Object> holder) {
  auto module = CompiledModule(holder);
  if (!module->IsSyntheticModule() || module->GetStatus() >= Module::kInstantiated) return true;
  if (module->InstantiateModule(context, Module::ResolveModuleCallback{}).IsNothing()) return false;
  // A synthetic leaf has no imports. Link it before returning it to V8, then
  // let its namespace retain the callback even if the host discards this holder.
  if (!module->GetModuleNamespace().As<Object>()->SetPrivate(context,
      SyntheticStepsKey(Isolate::GetCurrent()),
      holder->GetInternalField(kSyntheticSteps).As<Value>()).FromMaybe(false)) return false;
  holder->SetInternalField(kSyntheticSteps, Undefined(Isolate::GetCurrent()));
  return true;
}

void ModuleRequests(const FunctionCallbackInfo<Value>& args) {
  auto isolate = args.GetIsolate();
  auto host = isolate->GetCurrentContext();
  Local<Object> holder;
  if (!GetModuleHolder(args, args[0]).ToLocal(&holder)) return;
  auto requests = CompiledModule(holder)->GetModuleRequests();
  auto result = Array::New(isolate, requests->Length());
  for (int i = 0; i < requests->Length(); ++i) {
    auto request = ModuleItem(requests, host, i).As<ModuleRequest>();
    auto attributes = request->GetImportAttributes();
    auto pairs = Array::New(isolate, attributes->Length() / 3);
    for (int j = 0; j < attributes->Length(); j += 3) {
      auto pair = Object::New(isolate);
      if (pair->CreateDataProperty(host, Text(isolate, "key"),
              ModuleItem(attributes, host, j).As<Value>()).IsNothing() ||
          pair->CreateDataProperty(host, Text(isolate, "value"),
              ModuleItem(attributes, host, j + 1).As<Value>()).IsNothing() ||
          pairs->CreateDataProperty(host, j / 3, pair).IsNothing()) return;
    }
    const char* phase;
    switch (request->GetPhase()) {
      case ModuleImportPhase::kSource: phase = "source"; break;
      case ModuleImportPhase::kEvaluation: phase = "evaluation"; break;
#if V8_MAJOR_VERSION >= 14
      case ModuleImportPhase::kDefer: phase = "defer"; break;
#endif
    }
    auto entry = Object::New(isolate);
    if (entry->CreateDataProperty(host, Text(isolate, "specifier"), request->GetSpecifier()).IsNothing() ||
        entry->CreateDataProperty(host, Text(isolate, "attributes"), pairs).IsNothing() ||
        entry->CreateDataProperty(host, Text(isolate, "phase"), Text(isolate, phase)).IsNothing() ||
        result->CreateDataProperty(host, i, entry).IsNothing()) return;
  }
  args.GetReturnValue().Set(result);
}

struct ModuleDependencies {
  Local<Module> module;
  std::vector<Local<Object>> dependencies;
};

// Only lives during InstantiateModule. Dependencies are supplied by the host;
// V8 retains the linked graph and implements its bindings and execution order.
using ModuleLinks = std::unordered_multimap<int, ModuleDependencies>;
thread_local ModuleLinks* active_module_links = nullptr;

MaybeLocal<Object> SuppliedDependency(Local<Context> context,
    Local<String> specifier, Local<FixedArray> attributes, Local<Module> referrer,
    ModuleImportPhase phase) {
  auto isolate = Isolate::GetCurrent();
  auto range = active_module_links->equal_range(referrer->GetIdentityHash());
  for (auto entry = range.first; entry != range.second; ++entry) {
    if (entry->second.module != referrer) continue;
    auto requests = referrer->GetModuleRequests();
    for (int i = 0; i < requests->Length(); ++i) {
      auto request = ModuleItem(requests, context, i).As<ModuleRequest>();
      if (request->GetPhase() != phase || !request->GetSpecifier()->StrictEquals(specifier)) continue;
      auto expected = request->GetImportAttributes();
      if (expected->Length() != attributes->Length()) continue;
      bool equal = true;
      for (int j = 0; j < attributes->Length(); j += 3) {
        // Source offsets are diagnostics, not part of request identity.
        if (!ModuleItem(expected, context, j).As<Value>()->StrictEquals(
                ModuleItem(attributes, context, j).As<Value>()) ||
            !ModuleItem(expected, context, j + 1).As<Value>()->StrictEquals(
                ModuleItem(attributes, context, j + 1).As<Value>())) {
          equal = false;
          break;
        }
      }
      if (equal) return entry->second.dependencies[i];
    }
  }
  Fail(isolate, "ERR_MODULE_DEPENDENCY_MISSING", "No supplied dependency for this module request");
  return {};
}

MaybeLocal<Module> ResolveSuppliedModule(Local<Context> context,
    Local<String> specifier, Local<FixedArray> attributes, Local<Module> referrer) {
  Local<Object> dependency;
  if (!SuppliedDependency(context, specifier, attributes, referrer,
          ModuleImportPhase::kEvaluation).ToLocal(&dependency) ||
      !LinkSyntheticModule(context, dependency)) return {};
  return CompiledModule(dependency);
}

MaybeLocal<Object> ResolveSuppliedSource(Local<Context> context,
    Local<String> specifier, Local<FixedArray> attributes, Local<Module> referrer) {
  return SuppliedDependency(context, specifier, attributes, referrer, ModuleImportPhase::kSource);
}

void LinkModule(const FunctionCallbackInfo<Value>& args) {
  auto isolate = args.GetIsolate();
  auto host = isolate->GetCurrentContext();
  Local<Object> root;
  if (!GetModuleHolder(args, args[0]).ToLocal(&root)) return;
  if (!args[1]->IsMap()) {
    Fail(isolate, "ERR_INVALID_ARG_TYPE", "Expected a Map from module handles to dependency arrays");
    return;
  }
  auto context_handle = root->GetInternalField(kModuleContext).As<Value>();
  auto entries = args[1].As<Map>()->AsArray();
  ModuleLinks links;
  for (uint32_t i = 0; i < entries->Length(); i += 2) {
    Local<Value> value, dependencies;
    Local<Object> holder;
    if (!entries->Get(host, i).ToLocal(&value) ||
        !GetModuleHolder(args, value).ToLocal(&holder) ||
        !entries->Get(host, i + 1).ToLocal(&dependencies)) return;
    if (holder->GetInternalField(kModuleContext) != context_handle) {
      Fail(isolate, "ERR_MODULE_CONTEXT_MISMATCH", "Modules must belong to the same context");
      return;
    }
    auto module = CompiledModule(holder);
    auto requests = module->GetModuleRequests();
    if (!dependencies->IsArray() || dependencies.As<Array>()->Length() != requests->Length()) {
      Fail(isolate, "ERR_INVALID_ARG_VALUE", "Supply one dependency per module request, in request order");
      return;
    }
    ModuleDependencies entry{module, {}};
    for (int j = 0; j < requests->Length(); ++j) {
      auto phase = ModuleItem(requests, host, j).As<ModuleRequest>()->GetPhase();
      if (!dependencies.As<Array>()->Get(host, j).ToLocal(&value)) return;
      if (phase == ModuleImportPhase::kSource) {
        if (!value->IsWasmModuleObject()) {
          Fail(isolate, "ERR_INVALID_ARG_TYPE", "A source-phase dependency must be a WebAssembly.Module");
          return;
        }
        entry.dependencies.push_back(value.As<Object>());
        continue;
      }
      if (phase != ModuleImportPhase::kEvaluation) {
        Fail(isolate, "ERR_MODULE_PHASE_UNSUPPORTED", "Deferred-phase linking is not implemented");
        return;
      }
      Local<Object> dependency;
      if (!GetModuleHolder(args, value).ToLocal(&dependency)) return;
      if (dependency->GetInternalField(kModuleContext) != context_handle) {
        Fail(isolate, "ERR_MODULE_CONTEXT_MISMATCH", "Modules must belong to the same context");
        return;
      }
      entry.dependencies.push_back(dependency);
    }
    links.emplace(module->GetIdentityHash(), std::move(entry));
  }
  Local<Context> realm;
  if (!GetContext(args, context_handle, Data(args)->vm_data.Get(isolate)).ToLocal(&realm)) return;
  Context::Scope scope(realm);
  if (!LinkSyntheticModule(realm, root)) return;
  auto previous = active_module_links;
  active_module_links = &links;
  auto result = CompiledModule(root)->InstantiateModule(realm, ResolveSuppliedModule, ResolveSuppliedSource);
  active_module_links = previous;
  if (result.IsNothing()) return;
}

void EvaluateModule(const FunctionCallbackInfo<Value>& args) {
  auto isolate = args.GetIsolate();
  Local<Object> holder;
  if (!GetModuleHolder(args, args[0]).ToLocal(&holder)) return;
  Local<Context> realm;
  if (!GetContext(args, holder->GetInternalField(kModuleContext).As<Value>(),
          Data(args)->vm_data.Get(isolate)).ToLocal(&realm)) return;
  Context::Scope scope(realm);
  auto module = CompiledModule(holder);
  if (module->GetStatus() < Module::kInstantiated) {
    Fail(isolate, "ERR_MODULE_NOT_LINKED", "Link the module before evaluating it");
    return;
  }
  Local<Value> promise;
  if (module->Evaluate(realm).ToLocal(&promise)) args.GetReturnValue().Set(promise);
}

void ModuleStatus(const FunctionCallbackInfo<Value>& args) {
  Local<Object> holder;
  if (!GetModuleHolder(args, args[0]).ToLocal(&holder)) return;
  const char* names[] = {"unlinked", "linking", "linked", "evaluating", "evaluated", "errored"};
  args.GetReturnValue().Set(Text(args.GetIsolate(), names[CompiledModule(holder)->GetStatus()]));
}

void ModuleError(const FunctionCallbackInfo<Value>& args) {
  Local<Object> holder;
  if (!GetModuleHolder(args, args[0]).ToLocal(&holder)) return;
  auto module = CompiledModule(holder);
  if (module->GetStatus() != Module::kErrored) {
    Fail(args.GetIsolate(), "ERR_VM_MODULE_STATUS", "Module must be errored");
    return;
  }
  args.GetReturnValue().Set(module->GetException());
}

void ModuleNamespace(const FunctionCallbackInfo<Value>& args) {
  Local<Object> holder;
  if (!GetModuleHolder(args, args[0]).ToLocal(&holder)) return;
  auto module = CompiledModule(holder);
  if (module->GetStatus() < Module::kInstantiated) {
    Fail(args.GetIsolate(), "ERR_MODULE_NOT_LINKED", "Link the module before accessing its namespace");
    return;
  }
  args.GetReturnValue().Set(module->GetModuleNamespace());
}

}  // namespace

void InitializeVmModules(v8::Local<v8::Object> exports,
                         v8::Local<v8::Context> context,
                         v8::Local<v8::External> vm_data) {
  using namespace v8;
  auto isolate = Isolate::GetCurrent();
  auto data = new ModuleData{isolate};
  data->vm_data.Reset(isolate, vm_data);
  data->module_key.Reset(isolate, Private::New(isolate));
  auto module_template = ObjectTemplate::New(isolate);
  module_template->SetInternalFieldCount(kModuleFieldCount);
  data->module_template.Reset(isolate, module_template);
  node::AddEnvironmentCleanupHook(isolate, [](void* pointer) {
    auto data = static_cast<ModuleData*>(pointer);
#ifdef NODE_COMPAT_IMPORT_META
    data->isolate->SetHostInitializeImportMetaObjectCallback(
        node::HostInitializeImportMetaObjectCallback);
#endif
    delete data;
  }, data);
  auto external = External::New(isolate, data);

#ifdef NODE_COMPAT_IMPORT_META
  isolate->SetHostInitializeImportMetaObjectCallback(InitializeImportMeta);
#endif
  const struct { const char* name; FunctionCallback callback; } methods[] = {
    {"compileModule", CompileModule},
    {"moduleRequests", ModuleRequests},
    {"createSyntheticModule", CreateSyntheticModule},
    {"setSyntheticExport", SetSyntheticExport},
    {"linkModule", LinkModule},
    {"evaluateModule", EvaluateModule},
    {"moduleNamespace", ModuleNamespace},
    {"moduleStatus", ModuleStatus},
    {"moduleError", ModuleError},
#ifdef NODE_COMPAT_IMPORT_META
    {"setImportMetaInitializer", SetImportMetaInitializer},
#endif
  };
  for (const auto& method : methods) {
    Local<Function> function;
    if (!Function::New(context, method.callback, external).ToLocal(&function) ||
        exports->Set(context, Text(isolate, method.name), function).IsNothing()) return;
  }
}

}  // namespace node_compat
