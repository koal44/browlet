#include "threads.h"
#include <node.h>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <limits>
#include <memory>
#include <mutex>
#include <unordered_map>

namespace node_compat {
namespace {
using namespace v8;
using ThreadClock = std::chrono::steady_clock;

// Created by the outside owner before starting Node's Worker. The child attaches
// its isolate during trusted entry setup, so suspension can precede startup.
struct ThreadControl {
  Isolate* owner;
  Isolate* isolate = nullptr;
  uint32_t token;
  bool requested = false;
  bool pending = false;
  bool suspended = false;
  bool suspension_disabled = false;
  bool stopping = false;
  // Accepted suspension stops timer time immediately, including while Node is
  // idle and V8 has not yet entered the interrupt. Ordinary idle time counts.
  ThreadClock::time_point created = ThreadClock::now();
  ThreadClock::time_point suspension_started = created;
  ThreadClock::duration suspended_time{};
  std::condition_variable wake;
};

// Shared by context-aware loads of this binary in different isolates. Cleanup
// hooks retire entries; the registry itself outlives Node environment teardown.
struct ThreadRegistry {
  std::mutex mutex;
  uint32_t next = 0;
  std::unordered_map<uint32_t, std::shared_ptr<ThreadControl>> controls;
};

ThreadRegistry& Registry() {
  static auto* registry = new ThreadRegistry;
  return *registry;
}

void* TokenData(uint32_t token) {
  return reinterpret_cast<void*>(static_cast<uintptr_t>(token));
}

uint32_t Token(void* data) {
  return static_cast<uint32_t>(reinterpret_cast<uintptr_t>(data));
}

// Called under the registry lock for resumption, closing, and forced shutdown.
void Resume(ThreadControl& control) {
  if (control.requested) {
    control.suspended_time += ThreadClock::now() - control.suspension_started;
    control.requested = false;
  }
  control.wake.notify_all();
}

// Hold the registry lock for every isolate access, including cleanup. Stop
// descendants too: Node joins them during parent teardown, before cleanup hooks.
void Stop(ThreadRegistry& registry, ThreadControl& control) {
  if (control.stopping) return;
  control.stopping = true;
  if (control.isolate != nullptr) {
    for (const auto& [token, child] : registry.controls) {
      if (child->owner == control.isolate) Stop(registry, *child);
    }
    // Set termination before waking the stack: no author code may resume.
    // Explicit shutdown first calls Node's Worker.terminate(), which marks its
    // environment as stopping before any native callback starts unwinding.
    control.isolate->TerminateExecution();
  }
  Resume(control);
}

void OwnerCleanup(void* data) {
  auto& registry = Registry();
  std::lock_guard lock(registry.mutex);
  const auto found = registry.controls.find(Token(data));
  if (found == registry.controls.end()) return;
  auto& control = *found->second;
  Stop(registry, control);
  control.owner = nullptr;
  if (control.isolate == nullptr) registry.controls.erase(found);
}

void ThreadCleanup(void* data) {
  auto& registry = Registry();
  std::lock_guard lock(registry.mutex);
  const auto found = registry.controls.find(Token(data));
  if (found == registry.controls.end()) return;
  auto& control = *found->second;
  control.isolate = nullptr;
  control.stopping = true;
  if (control.owner == nullptr) registry.controls.erase(found);
}

void Interrupt(Isolate*, void* data) {
  auto& registry = Registry();
  std::unique_lock lock(registry.mutex);
  const auto found = registry.controls.find(Token(data));
  if (found == registry.controls.end()) return;
  auto control = found->second;
  control->pending = false;
  if (!control->requested || control->stopping) return;
  control->suspended = true;
  // V8 forbids JavaScript reentry here. This blocks Node's host queue as well:
  // resume and termination MUST use the outside native control, not a message.
  // Raw Node termination cannot wake this wait. The JSThread owner requests
  // Worker.terminate() first, then Stop wakes the wait without resuming script.
  control->wake.wait(lock, [&] { return !control->requested || control->stopping; });
  control->suspended = false;
}

void RequestSuspension(ThreadControl& control) {
  if (control.isolate != nullptr && !control.pending && !control.suspended) {
    control.pending = true;
    control.isolate->RequestInterrupt(Interrupt, TokenData(control.token));
  }
}

void CreateThreadControl(const FunctionCallbackInfo<Value>& args) {
  auto& registry = Registry();
  std::lock_guard lock(registry.mutex);
  if (registry.next == std::numeric_limits<uint32_t>::max()) {
    args.GetIsolate()->ThrowException(Exception::Error(
        String::NewFromUtf8Literal(args.GetIsolate(), "Thread control identifiers exhausted")));
    return;
  }
  auto control = std::make_shared<ThreadControl>();
  control->owner = args.GetIsolate();
  control->token = ++registry.next;
  registry.controls.emplace(control->token, control);
  node::AddEnvironmentCleanupHook(control->owner, OwnerCleanup, TokenData(control->token));
  args.GetReturnValue().Set(control->token);
}

void AttachThreadControl(const FunctionCallbackInfo<Value>& args) {
  args.GetReturnValue().Set(false);
  if (!args[0]->IsUint32()) return;
  auto& registry = Registry();
  std::lock_guard lock(registry.mutex);
  const auto found = registry.controls.find(args[0].As<Uint32>()->Value());
  if (found == registry.controls.end()) return;
  auto& control = *found->second;
  if (control.isolate != nullptr || control.owner == args.GetIsolate() || control.stopping) return;
  control.isolate = args.GetIsolate();
  node::AddEnvironmentCleanupHook(control.isolate, ThreadCleanup, TokenData(control.token));
  if (control.requested) RequestSuspension(control);
  args.GetReturnValue().Set(true);
}

// The inside execution owner can permanently rule out suspension before it
// enters closing/cleanup. Share the same lock with outside suspension requests,
// including pending interrupts, rather than relying on a closing notification.
void PreventThreadSuspension(const FunctionCallbackInfo<Value>& args) {
  if (!args[0]->IsUint32()) return;
  auto& registry = Registry();
  std::lock_guard lock(registry.mutex);
  const auto found = registry.controls.find(args[0].As<Uint32>()->Value());
  if (found == registry.controls.end() || found->second->isolate != args.GetIsolate()) return;
  auto& control = *found->second;
  control.suspension_disabled = true;
  Resume(control);
}

// Read time and accumulated suspension together. Combining a JS clock read with
// a later duration query could straddle a suspension and make the clock go back.
void GetThreadElapsedTime(const FunctionCallbackInfo<Value>& args) {
  if (!args[0]->IsUint32()) return;
  auto& registry = Registry();
  std::lock_guard lock(registry.mutex);
  const auto found = registry.controls.find(args[0].As<Uint32>()->Value());
  if (found == registry.controls.end() || found->second->isolate != args.GetIsolate()) return;
  const auto& control = *found->second;
  const auto now = control.requested ? control.suspension_started : ThreadClock::now();
  const auto elapsed = now - control.created - control.suspended_time;
  args.GetReturnValue().Set(std::chrono::duration<double, std::milli>(elapsed).count());
}

enum class Action { Suspend, Resume, Stop, Suspended, Release };
template<Action action>
void Control(const FunctionCallbackInfo<Value>& args) {
  if constexpr (action == Action::Suspended) args.GetReturnValue().Set(false);
  if (!args[0]->IsUint32()) return;
  auto& registry = Registry();
  std::lock_guard lock(registry.mutex);
  const auto found = registry.controls.find(args[0].As<Uint32>()->Value());
  if (found == registry.controls.end() || found->second->owner != args.GetIsolate()) return;
  auto& control = *found->second;
  if constexpr (action == Action::Suspended) {
    args.GetReturnValue().Set(control.suspended);
  } else if constexpr (action == Action::Release) {
    Stop(registry, control);
    node::RemoveEnvironmentCleanupHook(control.owner, OwnerCleanup, TokenData(control.token));
    control.owner = nullptr;
    if (control.isolate == nullptr) registry.controls.erase(found);
  } else if constexpr (action == Action::Stop) {
    Stop(registry, control);
  } else if (!control.stopping) {
    if constexpr (action == Action::Suspend) {
      if (control.suspension_disabled) return;
      if (!control.requested) {
        control.suspension_started = ThreadClock::now();
        control.requested = true;
      }
      RequestSuspension(control);
    } else {
      Resume(control);
    }
  }
}
}  // namespace

void InitializeThreads(v8::Local<v8::Object> exports) {
  NODE_SET_METHOD(exports, "createThreadControl", CreateThreadControl);
  NODE_SET_METHOD(exports, "attachThreadControl", AttachThreadControl);
  NODE_SET_METHOD(exports, "preventThreadSuspension", PreventThreadSuspension);
  NODE_SET_METHOD(exports, "getThreadElapsedTime", GetThreadElapsedTime);
  NODE_SET_METHOD(exports, "suspendThread", Control<Action::Suspend>);
  NODE_SET_METHOD(exports, "resumeThread", Control<Action::Resume>);
  NODE_SET_METHOD(exports, "stopThread", Control<Action::Stop>);
  NODE_SET_METHOD(exports, "isThreadSuspended", Control<Action::Suspended>);
  NODE_SET_METHOD(exports, "releaseThreadControl", Control<Action::Release>);
}
}  // namespace node_compat
