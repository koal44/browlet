# Browlet Web IDL integration

[`composition.ts`](composition.ts) assembles browser environments and the shared
BindingWorld. [`web-idl.ts`](web-idl.ts) collects declarations from their feature
owners without constructing the world. [`bindings/`](bindings/index.ts) supplies
the HTML-specific binding rules installed by composition.

The generic [Web IDL subsystem](../../../web-idl/README.md) owns declaration
assembly, conversion, and platform identity. This directory supplies Browlet's
choices and HTML integration. Implementation algorithms use their supplied
environment and do not import composition or discover its BindingWorld.

## Environment creation

`createWindowEnvironment()` allocates the realm and environment before constructing
Window and installing its platform global. `createBrowletEnvironmentInit()` supplies
the binding-aware InternalPromise constructor, host background scheduling, DOM
document/event/abort allocation, and structured-data functions. The environment
assigns those facilities directly and discards the initialization record.

The realm initially reads security from a BrowletEnvironmentBase. Registration
constructs the complete WindowEnvironment before global projection, retaining the
base state and adding its realm and facilities. Composition then constructs Window,
links it to the realm, and installs the shared global-scope mixin. Document creation
retains its own HTML initialization; descendant allocation uses that document's
environment and its binding ownership. Event creation is available before projection.

The environment reads the live global through its realm and resolves DOMException
lazily because global installation and interface registration finish later. Fetch
task delivery selects the destination global's realm and queues on its networking
task source, which can differ from the environment initiating the operation.

## Binding rules

HTML's extended-attribute handlers prepare reflection after type resolution, once
per world. Declarations retain annotations and typed metadata; invocation uses the
receiver's binding. Reusable HTML value rules and DOM state remain with their owners.
Custom-element reaction wrapping remains an explicit dependency of its owning slice.

Cross-origin binding supplies Web IDL security checks and HTML's shared descriptor
algorithms. WindowProxy and Location integration use those rules at their platform
boundaries; the [Window roadmap](../../browsing/window/ROADMAP.md) records remaining
native limitations and specification dependencies.

Binding hooks can consume browser implementations and generic Web IDL facilities.
They cannot import the higher composition module. UserAgent owns the browser lifetime
and consumes the factories through this directory's export-only index.
