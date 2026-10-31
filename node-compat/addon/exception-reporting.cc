#include <node.h>
#include "exception-reporting.h"
#include "vm.h"

namespace node_compat {
namespace {
using namespace v8;

#ifndef NODE_COMPAT_CONTEXT_EXCEPTION_REPORTER
Local<Private> ReporterKey(Isolate* isolate) {
  return Private::ForApi(isolate,
      String::NewFromUtf8Literal(isolate, "node-compat.exceptionReporter"));
}

// The entered context remains the registry's context during Node's reporting
// call, even when the cleanup callback was created in a different context.
void GetEnteredExceptionReporter(const FunctionCallbackInfo<Value>& args) {
  auto isolate = args.GetIsolate();
  auto context = isolate->GetEnteredOrMicrotaskContext();
  if (context.IsEmpty()) return;
  args.GetReturnValue().Set(context->GetExtrasBindingObject()
      ->GetPrivate(context, ReporterKey(isolate)).ToLocalChecked());
}
#endif

void SetExceptionReporter(const FunctionCallbackInfo<Value>& args) {
  auto isolate = args.GetIsolate();
  Local<Context> context;
  if (!GetContext(args, args[0]).ToLocal(&context)) return;
  if (!args[1]->IsFunction() && !args[1]->IsUndefined()) {
    isolate->ThrowException(Exception::TypeError(String::NewFromUtf8Literal(
        isolate, "Expected an exception reporter or undefined")));
    return;
  }
#ifdef NODE_COMPAT_CONTEXT_EXCEPTION_REPORTER
  node::SetContextExceptionReporter(context,
      args[1]->IsFunction() ? args[1].As<Function>() : Local<Function>());
#else
  context->GetExtrasBindingObject()->SetPrivate(context, ReporterKey(isolate), args[1]).Check();
#endif
}
}  // namespace

void InitializeExceptionReporting(v8::Local<v8::Object> exports,
                                  v8::Local<v8::Context> context,
                                  v8::Local<v8::External> vm_data) {
  using namespace v8;
  auto isolate = Isolate::GetCurrent();
  exports->CreateDataProperty(context,
      String::NewFromUtf8Literal(isolate, "setExceptionReporter"),
      Function::New(context, SetExceptionReporter, vm_data).ToLocalChecked()).Check();
#ifndef NODE_COMPAT_CONTEXT_EXCEPTION_REPORTER
  NODE_SET_METHOD(exports, "getEnteredExceptionReporter", GetEnteredExceptionReporter);
#endif
}
}  // namespace node_compat
