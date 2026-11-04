#include <node.h>
#include "code-generation.h"

namespace node_compat {
namespace {
using namespace v8;

struct Registration {
  Isolate* isolate;
};

Local<Private> WasmCallbackKey(Isolate* isolate) {
  return Private::ForApi(isolate, String::NewFromUtf8Literal(isolate, "browlet.wasmCodeGeneration.callback"));
}

bool AllowWasmCodeGeneration(Local<Context> context, Local<String> source) {
  // Node's public handler preserves vm.createContext({ codeGeneration: { wasm: false } }).
  // Unlike the string-compilation forwarder, this export is available on every supported base.
  if (!node::AllowWasmCodeGenerationCallback(context, source)) return false;
  auto isolate = Isolate::GetCurrent();
  HandleScope handles(isolate);
  auto callback = context->GetExtrasBindingObject()->GetPrivate(context, WasmCallbackKey(isolate)).ToLocalChecked();
  if (callback->IsUndefined()) return true;
  auto function = callback.As<Function>();
  auto host = function->GetCreationContext().ToLocalChecked();
  Context::Scope scope(host);
  Local<Value> result;
  // This is an internal policy decision, not an author callback. V8 expects a
  // boolean and creates CompileError itself; it cannot propagate a thrown value here.
  if (!function->Call(host, Undefined(isolate), 0, nullptr).ToLocal(&result)) {
    node::OnFatalError("node-compat Wasm code generation", "Policy callback must not throw");
  }
  if (!result->IsBoolean()) {
    node::OnFatalError("node-compat Wasm code generation", "Policy callback must return a boolean");
  }
  return result->IsTrue();
}

void SetAllowWasmCodeGenerationCallback(const FunctionCallbackInfo<Value>& args) {
  auto isolate = args.GetIsolate();
  if (!args[0]->IsObject() || (!args[1]->IsFunction() && !args[1]->IsUndefined())) {
    isolate->ThrowException(Exception::TypeError(String::NewFromUtf8Literal(
        isolate, "Expected a realm reference and a callback or undefined")));
    return;
  }
  Local<Context> context;
  if (!args[0].As<Object>()->GetCreationContext().ToLocal(&context)) return;
  // Context-local private state neither retains dead realms globally nor follows a reused global proxy.
  auto state = context->GetExtrasBindingObject();
  if (args[1]->IsUndefined()) state->DeletePrivate(context, WasmCallbackKey(isolate)).Check();
  else state->SetPrivate(context, WasmCallbackKey(isolate), args[1]).Check();
}

#ifdef NODE_COMPAT_CODE_GENERATION
Local<Private> CallbackKey(Isolate* isolate) {
  return Private::ForApi(isolate, String::NewFromUtf8Literal(isolate, "browlet.codeGeneration.callback"));
}

Local<Private> OriginalAllowanceKey(Isolate* isolate) {
  return Private::ForApi(isolate, String::NewFromUtf8Literal(isolate, "browlet.codeGeneration.originalAllowance"));
}

ModifyCodeGenerationFromStringsResult ModifyCodeGenerationFromStrings(
    Local<Context> context, Local<Value> source, bool is_code_like) {
  auto isolate = Isolate::GetCurrent();
  Local<Value> callback;
  if (!context->GetExtrasBindingObject()->GetPrivate(context, CallbackKey(isolate)).ToLocal(&callback)) {
    return {false, {}};
  }
  if (callback->IsUndefined()) {
    return node::ModifyCodeGenerationFromStrings(context, source, is_code_like);
  }

  Local<Value> result;
  Local<Value> arguments[] = {source, Boolean::New(isolate, is_code_like)};
  {
    auto function = callback.As<Function>();
    auto host = function->GetCreationContext().ToLocalChecked();
    Context::Scope scope(host);
    if (!function->Call(host, Undefined(isolate), 2, arguments).ToLocal(&result)) return {false, {}};
  }
  if (result->IsFalse()) return {false, {}};
  if (result->IsUndefined()) {
    return node::ModifyCodeGenerationFromStrings(context, source, is_code_like);
  }
  if (!result->IsString()) {
    isolate->ThrowException(Exception::TypeError(String::NewFromUtf8Literal(
        isolate, "Expected a source string, false, or undefined")));
    return {false, {}};
  }
  // Extracted source still passes through Node's permission and source-map
  // handling. Supplying a replacement must never bypass the target's policy.
  auto decision = node::ModifyCodeGenerationFromStrings(context, result, is_code_like);
  if (decision.codegen_allowed && decision.modified_source.IsEmpty()) {
    decision.modified_source = result.As<String>();
  }
  return decision;
}

void SetModifyCodeGenerationFromStringsCallback(const FunctionCallbackInfo<Value>& args) {
  auto isolate = args.GetIsolate();
  if (!args[0]->IsObject() || (!args[1]->IsFunction() && !args[1]->IsUndefined())) {
    isolate->ThrowException(Exception::TypeError(String::NewFromUtf8Literal(
        isolate, "Expected a realm reference and a callback or undefined")));
    return;
  }
  Local<Context> context;
  if (!args[0].As<Object>()->GetCreationContext().ToLocal(&context)) return;
  auto state = context->GetExtrasBindingObject();
  Local<Value> original;
  if (!state->GetPrivate(context, OriginalAllowanceKey(isolate)).ToLocal(&original)) return;
  if (args[1]->IsUndefined()) {
    if (original->IsUndefined()) return;
    if (state->DeletePrivate(context, CallbackKey(isolate)).IsNothing() ||
        state->DeletePrivate(context, OriginalAllowanceKey(isolate)).IsNothing()) return;
    context->AllowCodeGenerationFromStrings(original->IsTrue());
    return;
  }
  if (original->IsUndefined() &&
      state->SetPrivate(context, OriginalAllowanceKey(isolate),
          Boolean::New(isolate, context->IsCodeGenerationFromStringsAllowed())).IsNothing()) return;
  if (state->SetPrivate(context, CallbackKey(isolate), args[1]).IsNothing()) return;
  // Check every compilation, including cached source. Node's separate
  // permission remains intact. Context extras do not follow a reused global.
  context->AllowCodeGenerationFromStrings(false);
}
#endif
}  // namespace

void InitializeCodeGeneration(v8::Local<v8::Object> exports) {
  auto isolate = v8::Isolate::GetCurrent();
  isolate->SetAllowWasmCodeGenerationCallback(AllowWasmCodeGeneration);
#ifdef NODE_COMPAT_CODE_GENERATION
  isolate->SetModifyCodeGenerationFromStringsCallback(ModifyCodeGenerationFromStrings);
#endif
  node::AddEnvironmentCleanupHook(isolate, [](void* pointer) {
    auto registration = static_cast<Registration*>(pointer);
    registration->isolate->SetAllowWasmCodeGenerationCallback(node::AllowWasmCodeGenerationCallback);
#ifdef NODE_COMPAT_CODE_GENERATION
    registration->isolate->SetModifyCodeGenerationFromStringsCallback(node::ModifyCodeGenerationFromStrings);
#endif
    delete registration;
  }, new Registration{isolate});
  NODE_SET_METHOD(exports, "setAllowWasmCodeGenerationCallback", SetAllowWasmCodeGenerationCallback);
#ifdef NODE_COMPAT_CODE_GENERATION
  NODE_SET_METHOD(exports, "setModifyCodeGenerationFromStringsCallback", SetModifyCodeGenerationFromStringsCallback);
#endif
}
}  // namespace node_compat
