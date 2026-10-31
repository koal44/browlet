#ifndef NODE_COMPAT_EXOTIC_OBJECT_H_
#define NODE_COMPAT_EXOTIC_OBJECT_H_

#include <v8.h>

namespace node_compat {
void InitializeExoticObject(v8::Local<v8::Object> exports,
                           v8::Local<v8::Context> context);
}

#endif  // NODE_COMPAT_EXOTIC_OBJECT_H_
