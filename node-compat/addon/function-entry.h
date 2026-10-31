#ifndef NODE_COMPAT_FUNCTION_ENTRY_H_
#define NODE_COMPAT_FUNCTION_ENTRY_H_

#include <v8.h>

namespace node_compat {
void InitializeFunctionEntry(v8::Local<v8::Object> exports,
                             v8::Local<v8::Context> context,
                             v8::Local<v8::External> vm_data);
}  // namespace node_compat

#endif  // NODE_COMPAT_FUNCTION_ENTRY_H_
