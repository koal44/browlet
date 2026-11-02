#include <node.h>
#include "object-types.h"

namespace node_compat {
namespace {

void IsWebAssemblyModule(const v8::FunctionCallbackInfo<v8::Value>& args) {
  args.GetReturnValue().Set(args[0]->IsWasmModuleObject());
}

int ObjectInstanceType(v8::Local<v8::Value> object) {
  // HACK: V8 has IsWasmGlobalObject internally but no public Value predicate.
  // We deliberately use private helpers from the matching Node headers and
  // sample a real Global's tag, rather than hard-coding a type number or offset.
  // V8 warns against depending on these helpers; retest when updating Node/V8.
  // Alternatives considered: expose the existing check with a small V8 patch
  // (requires a custom engine), or use a public Wasm import/re-export probe
  // (works in JS, but allocates an Instance/LinkError per check). This addon-only
  // path works on official Node too and avoids that allocation/exception cost.
  // Do not replace it with a value getter: vector Globals throw, and function
  // values can acquire their first JS wrapper in the inspecting realm.
  const auto address = v8::internal::ValueHelper::ValueAsAddress(*object);
  return v8::internal::Internals::GetInstanceType(address);
}

void IsWebAssemblyGlobal(const v8::FunctionCallbackInfo<v8::Value>& args) {
  const int expected = args.Data().As<v8::Int32>()->Value();
  args.GetReturnValue().Set(args[0]->IsObject() &&
                          ObjectInstanceType(args[0]) == expected);
}

void IsWeakRef(const v8::FunctionCallbackInfo<v8::Value>& args) {
  args.GetReturnValue().Set(args[0]->IsWeakRef());
}

#if defined(NODE_COMPAT_FINALIZATION_REGISTRY_PREDICATE)
void IsFinalizationRegistry(const v8::FunctionCallbackInfo<v8::Value>& args) {
  args.GetReturnValue().Set(args[0]->IsFinalizationRegistry());
}
#endif

}  // namespace

bool InitializeObjectTypes(v8::Local<v8::Object> exports,
                           v8::Local<v8::Context> context) {
  auto isolate = v8::Isolate::GetCurrent();
  int global_type;
  {
    v8::HandleScope scope(isolate);
    // Never sample an author-replaceable constructor or caller-selected object.
    // Only the integer tag survives this scope; no context/object registry is
    // retained, and each Node environment (including workers) initializes itself.
    auto private_context = v8::Context::New(isolate);
    if (private_context.IsEmpty()) return false;
    v8::Context::Scope enter(private_context);
    auto source = v8::String::NewFromUtf8Literal(
        isolate, "new WebAssembly.Global({value:'i32'})");
    v8::Local<v8::Script> script;
    v8::Local<v8::Value> sample;
    if (!v8::Script::Compile(private_context, source).ToLocal(&script) ||
        !script->Run(private_context).ToLocal(&sample)) return false;
    global_type = ObjectInstanceType(sample);
  }
  v8::Local<v8::Function> predicate;
  if (!v8::Function::New(context, IsWebAssemblyGlobal,
          v8::Integer::New(isolate, global_type)).ToLocal(&predicate) ||
      exports->Set(context,
          v8::String::NewFromUtf8Literal(isolate, "isWebAssemblyGlobal"),
          predicate).IsNothing()) return false;
  NODE_SET_METHOD(exports, "isWebAssemblyModule", IsWebAssemblyModule);
  NODE_SET_METHOD(exports, "isWeakRef", IsWeakRef);
#if defined(NODE_COMPAT_FINALIZATION_REGISTRY_PREDICATE)
  NODE_SET_METHOD(exports, "isFinalizationRegistry", IsFinalizationRegistry);
#endif
  return true;
}

}  // namespace node_compat
