# Animation roadmap

Planned shared timing, playback, and effect state. This folder has no animation
implementation. Stylelet supplies property parsing/interpolation and CSS rule
producers; Browlet supplies document association, environments, and scheduled
updates. Time/easing helpers and named rendering phases are not an animation engine.

## Sources and scope

Read local CSSWG `web-animations-1/Overview.bs` and relevant later additions.
[Web Animations](https://drafts.csswg.org/web-animations-1/#web-animations-model-overview)
separates timing progress from applying effects to target properties. Interface
and delivery contracts were inspected; complete timing algorithms and CSS event
rules remain to be audited.

| Work | Contract and integration |
| --- | --- |
| Animation and timelines | Current/pending playback state, timeline association, ready/finished promises, cancel/finish behavior, events, and retained identity |
| AnimationEffect / KeyframeEffect | Timing parameters, iteration progress, targets, keyframes, and effect composition |
| Property effects | Preserve replace/add/accumulate and underlying values; consume Stylelet's property operations without string round-trips |
| CSS producers | CSSAnimation/CSSTransition interfaces, style-change rules, and keyframe rules; Stylelet owns CSS interpretation and cascade participation |
| Host integration | Element.animate/getAnimations, Document timelines and lookup, task/microtask/event delivery, teardown, and real update times |

## Dependency boundaries

- Let the existing HTML [update sequence](https://drafts.csswg.org/web-animations-1/#animation-frame-loop)
  drive sampling and delivery. No private requestAnimationFrame loop, timer
  source, or scheduler belongs in this subsystem. Core timing can be tested
  with explicit time inputs before document integration exists.
- Keep effect state here and value combination in Stylelet. Define the sampled
  contribution consumed by the cascade without reciprocal engine imports;
  the composition boundary connects producers, targets, and update ordering.
- Reuse existing execution and DOM event machinery for public interfaces.
  Settle EventTarget and target-identity dependencies before binding Animation;
  do not invent a generic callback facade to hide the missing integration.
- [@starting-style](https://drafts.csswg.org/css-transitions-2/#defining-before-change-style)
  supplies before-change style for transitions. It is not another ordinary
  after-change declaration source.
- [Scroll/view timelines](https://drafts.csswg.org/scroll-animations-1/#event-loop)
  consume layout/scroll facts and constrained resampling after layout. A style
  query must not advance them opportunistically.
- [View transitions](https://drafts.csswg.org/css-view-transitions-1/#lifecycle)
  additionally need capture, rendering suppression, author callbacks, pseudo
  subjects, and cleanup. Browlet's [rendering integration](../browlet/rendering/ROADMAP.md#observations-and-presentation)
  coordinates those dependencies and the distinct promise phases.
- [Animation Worklet](https://drafts.css-houdini.org/css-animation-worklet-1/)
  adds worklet animation state and execution; it requires this model as well
  as [worklet lifetime](../browlet/worklets/ROADMAP.md#css-worklet-consumers).

CSS Easing, Animations/Transitions, Web Animations, and Scroll Animations have
different contributions. Later animation-trigger/pointer-animation drafts need
their own scope review; their presence in the CSSWG checkout is not support.

## First implementation and checks

Start with bounded timing/playback tests, then a real target/property effect.
Test iteration boundaries, pending transitions, cancellation and replacement,
composition, and retained promises. Connect public methods/events through the
host binding and prove HTML update ordering with the existing scheduler.
Keep animation-driven style changes separate from layout/paint verification.
Exact source splits remain open; no adapter interface is fixed by this roadmap.
