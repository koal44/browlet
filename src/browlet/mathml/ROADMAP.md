# MathML host roadmap

## Present

- `element.ts`: `MathMLElement` base identity and inline-style integration.
- `web-idl.ts`: MathML contributions to Browlet's final Web IDL assembly.

## Missing

- [ ] Add concrete MathML Core element behavior only where parsing, style, or
  layout semantics require it.
- [ ] Complete MathML attribute reflection and HTML foreign-content parser
  adjustments (HTML §13.2.6, foreign-content rules).
- [ ] Define the supported MathML Core profile before introducing layout
  objects; layout itself is not part of this source reorganization.

HTML §3.2.5 owns integration, while MathML Core owns the interfaces and
semantics. Blink likewise keeps MathML as a sibling `core/mathml` subsystem.

## Removal condition

Burn this file once Browlet's supported MathML profile and any remaining
specification gaps have narrower owners.
