#include <node.h>
#include "vm-imports.h"
#include "vm.h"

namespace node_compat {
namespace {
using namespace v8;

Local<String> Text(Isolate* isolate, const char* text) {
  return String::NewFromUtf8(isolate, text).ToLocalChecked();
}

Local<Symbol> Marker(Isolate* isolate) {
  return Symbol::ForApi(isolate, Text(isolate, "browlet.dynamicImport"));
}

#ifdef NODE_COMPAT_DYNAMIC_IMPORT
Local<Private> RouterKey(Isolate* isolate) {
  return Private::ForApi(isolate, Text(isolate, "browlet.dynamicImportRouter"));
}

Local<Private> ContextLoaderKey(Isolate* isolate) {
  return Private::ForApi(isolate, Text(isolate, "browlet.contextImportLoader"));
}

void SetContextImportLoader(const FunctionCallbackInfo<Value>& args) {
  auto isolate = args.GetIsolate();
  Local<Context> context;
  if (!GetContext(args, args[0]).ToLocal(&context)) return;
  if (!args[1]->IsSymbol()) {
    isolate->ThrowException(Exception::TypeError(Text(isolate, "Expected an import loader symbol")));
    return;
  }
  // Extras belong to this context, not its potentially reused global proxy.
  if (context->GetExtrasBindingObject()->SetPrivate(context,
          ContextLoaderKey(isolate), args[1]).IsNothing()) return;
}

void NormalizeResult(const FunctionCallbackInfo<Value>& args) {
  auto context = args.GetIsolate()->GetCurrentContext();
  auto data = args.Data().As<Array>();
  Local<Value> normalize, phase, result;
  if (!data->Get(context, 0).ToLocal(&normalize) || !data->Get(context, 1).ToLocal(&phase)) return;
  Local<Value> arguments[] = {args[0], phase};
  if (normalize.As<Function>()->Call(context, Undefined(args.GetIsolate()), 2, arguments).ToLocal(&result)) {
    args.GetReturnValue().Set(result);
  }
}

MaybeLocal<Promise> ImportDynamically(Local<Context> context, Local<v8::Data> metadata,
                                    Local<Value> resource_name, Local<String> specifier,
                                    ModuleImportPhase phase, Local<FixedArray> attributes) {
  auto isolate = Isolate::GetCurrent();
  EscapableHandleScope handles(isolate);
  Context::Scope scope(context);
  auto options = metadata.As<FixedArray>();
  Local<Value> id = Undefined(isolate);
  if (options->Length() == 2 && options->Get(0) == Marker(isolate)) {
    id = options->Get(1).As<Symbol>();
  } else if (options->Length() == 0) {
    // Only missing metadata uses the fallback; foreign metadata stays with Node.
    if (!context->GetExtrasBindingObject()->GetPrivate(context,
            ContextLoaderKey(isolate)).ToLocal(&id)) return {};
  }
  if (id->IsUndefined()) {
    return handles.EscapeMaybe(node::ImportModuleDynamicallyWithPhase(
        context, metadata, resource_name, specifier, phase, attributes));
  }

  auto host = node::GetMainContext(node::GetCurrentEnvironment(context));
  Local<Value> router_value, load, normalize;
  if (!host->GetExtrasBindingObject()->GetPrivate(host, RouterKey(isolate)).ToLocal(&router_value)) return {};
  auto router = router_value.As<Array>();
  if (!router->Get(host, 0).ToLocal(&load) || !router->Get(host, 1).ToLocal(&normalize)) return {};
  auto import_attributes = Object::New(isolate, Null(isolate), nullptr, nullptr, 0);
  for (int i = 0; i < attributes->Length(); i += 2) {
    if (import_attributes->CreateDataProperty(context, attributes->Get(i).As<String>(),
            attributes->Get(i + 1).As<Value>()).IsNothing()) return {};
  }
  const char* phase_name = phase == ModuleImportPhase::kEvaluation ? "evaluation" :
                          phase == ModuleImportPhase::kSource ? "source" : "defer";
  Local<Value> arguments[] = {id, specifier,
      import_attributes, Text(isolate, phase_name)};
  Local<Promise::Resolver> resolver;
  if (!Promise::Resolver::New(context).ToLocal(&resolver)) return {};
  Local<Value> result;
  {
    TryCatch caught(isolate);
    if (!load.As<Function>()->Call(context, Undefined(isolate), 4, arguments).ToLocal(&result)) {
      if (!caught.CanContinue()) {
        caught.ReThrow();
        return {};
      }
      auto error = caught.Exception();
      caught.Reset();
      if (resolver->Reject(context, error).IsNothing()) return {};
      return handles.Escape(resolver->GetPromise());
    }
  }
  if (resolver->Resolve(context, result).IsNothing()) return {};
  // Node accepts a Module or namespace, including an asynchronous result. Keep
  // this continuation in the importing context instead of Node's host queue.
  Local<Function> finish;
  Local<Promise> promise;
  Local<Value> normalization[] = {normalize, Text(isolate, phase_name)};
  if (!Function::New(context, NormalizeResult, Array::New(isolate, normalization, 2)).ToLocal(&finish) ||
      !resolver->GetPromise()->Then(context, finish).ToLocal(&promise)) return {};
  return handles.Escape(promise);
}

void InstallDynamicImportRouter(const FunctionCallbackInfo<Value>& args) {
  auto isolate = args.GetIsolate();
  if (!args[0]->IsFunction() || !args[1]->IsFunction()) {
    isolate->ThrowException(Exception::TypeError(Text(isolate, "Expected import routing callbacks")));
    return;
  }
  auto host = node::GetMainContext(node::GetCurrentEnvironment(isolate->GetCurrentContext()));
  Local<Value> callbacks[] = {args[0], args[1]};
  if (host->GetExtrasBindingObject()->SetPrivate(host, RouterKey(isolate),
          Array::New(isolate, callbacks, 2)).IsNothing()) return;
  isolate->SetHostImportModuleWithPhaseDynamicallyCallback(ImportDynamically);
  node::AddEnvironmentCleanupHook(isolate, [](void* pointer) {
    static_cast<Isolate*>(pointer)->SetHostImportModuleWithPhaseDynamicallyCallback(
        node::ImportModuleDynamicallyWithPhase);
  }, isolate);
}
#endif
}  // namespace

v8::MaybeLocal<v8::Data> DynamicImportOptions(v8::Isolate* isolate,
                                            v8::Local<v8::Value> loader) {
  if (loader->IsUndefined()) return v8::PrimitiveArray::New(isolate, 0);
  if (!loader->IsSymbol()) {
    isolate->ThrowException(v8::Exception::TypeError(Text(isolate, "Expected an import loader symbol")));
    return {};
  }
  auto options = v8::PrimitiveArray::New(isolate, 2);
  options->Set(isolate, 0, Marker(isolate));
  options->Set(isolate, 1, loader.As<v8::Symbol>());
  return options;
}

void InitializeVmImports(v8::Local<v8::Object> exports, v8::Local<v8::Context> context,
                         v8::Local<v8::External> vm_data) {
#ifdef NODE_COMPAT_DYNAMIC_IMPORT
  NODE_SET_METHOD(exports, "installDynamicImportRouter", InstallDynamicImportRouter);
  v8::Local<v8::Function> setter;
  if (!v8::Function::New(context, SetContextImportLoader, vm_data).ToLocal(&setter) ||
      exports->Set(context, Text(v8::Isolate::GetCurrent(), "setContextImportLoader"), setter).IsNothing()) return;
#endif
}
}  // namespace node_compat
