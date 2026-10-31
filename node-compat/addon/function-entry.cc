#include "function-entry.h"
#include "realm.h"
#include "vm.h"

#include <vector>

namespace node_compat {
namespace {
using namespace v8;

Local<String> Text(Isolate* isolate, const char* text) {
  return String::NewFromUtf8(isolate, text).ToLocalChecked();
}

void Call(const FunctionCallbackInfo<Value>& args) {
  auto isolate = args.GetIsolate();
  // Capture before entering the JavaScript implementation: its frame would
  // otherwise replace the author frame that HTML needs as the incumbent.
  auto incumbent = isolate->GetIncumbentContext();
  Local<Value> reference = incumbent.IsEmpty()
      ? Local<Value>(Null(isolate)) : Local<Value>(GetRealmReference(incumbent));
  auto steps = args.Data().As<Function>();
  Local<Context> host;
  if (!steps->GetCreationContext().ToLocal(&host)) return;
  Context::Scope scope(host);
  std::vector<Local<Value>> values(args.Length());
  for (int i = 0; i < args.Length(); ++i) values[i] = args[i];
  Local<Value> arguments[] = {
    reference, args.This(), Array::New(isolate, values.data(), args.Length()),
  };
  Local<Value> result;
  if (steps->Call(host, Undefined(isolate), 3, arguments).ToLocal(&result)) {
    args.GetReturnValue().Set(result);
  }
}

void CreateFunctionWithIncumbent(const FunctionCallbackInfo<Value>& args) {
  auto isolate = args.GetIsolate();
  Local<Context> context;
  if (!GetContext(args, args[0]).ToLocal(&context)) return;
  if (!args[1]->IsFunction()) {
    auto error = Exception::TypeError(Text(isolate, "Function steps must be callable")).As<Object>();
    if (error->CreateDataProperty(isolate->GetCurrentContext(), Text(isolate, "code"),
          Text(isolate, "ERR_INVALID_ARG_TYPE")).IsNothing()) return;
    isolate->ThrowException(error);
    return;
  }
  Context::Scope scope(context);
  Local<Function> function;
  if (Function::New(context, Call, args[1], 0, ConstructorBehavior::kThrow).ToLocal(&function)) {
    args.GetReturnValue().Set(function);
  }
}

}  // namespace

void InitializeFunctionEntry(v8::Local<v8::Object> exports,
                             v8::Local<v8::Context> context,
                             v8::Local<v8::External> vm_data) {
  v8::Local<v8::Function> create;
  if (!v8::Function::New(context, CreateFunctionWithIncumbent, vm_data).ToLocal(&create)) return;
  exports->CreateDataProperty(context, Text(v8::Isolate::GetCurrent(), "createFunctionWithIncumbent"), create).Check();
}

}  // namespace node_compat
