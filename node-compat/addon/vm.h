#ifndef NODE_COMPAT_VM_H_
#define NODE_COMPAT_VM_H_

#include <v8.h>

namespace node_compat {
void InitializeVm(v8::Local<v8::Object> exports, v8::Local<v8::Context> context);
}  // namespace node_compat

#endif  // NODE_COMPAT_VM_H_
