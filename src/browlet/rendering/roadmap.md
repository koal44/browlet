# Rendering roadmap

HTML §15 describes the suggested default presentation of HTML documents. Its
rules are expressed in CSS, but it is not another CSS engine: Stylelet supplies
cascaded and computed values, while this domain eventually turns them into
layout boxes, viewports, replaced content, widgets, paint, and print output.

| Planned area or owner | Contract | Specification |
| --- | --- | --- |
| `box-tree/` | CSS/SVG box association, `display: contents`, “being rendered”, rendering delegation, and viewport intersection inputs | HTML §15 introduction; CSS Display and layout specifications |
| `layout/` | Block, inline, table, list, form-control, bidi, intrinsic sizing, margin quirks, and viewport layout | HTML §15 non-replaced elements plus the corresponding CSS modules |
| `replaced/` | Replaced-content selection, intrinsic dimensions, aspect ratios, images, embedded content, and nested-navigable viewports | HTML §15 replaced elements; CSS Images and Sizing |
| `widgets/` | Native appearance and UA shadow structures for buttons, details, form controls, select, progress, meter, and marquee compatibility | HTML §15 widgets plus interaction/form state |
| `print.ts` | Printing steps and physical-form output through an embedder capability | HTML §§8.9 and 15 print media; CSS Paged Media |
| `native-ui.ts` | Direction-aware tooltips, labels, menus, and other text surfaced outside the document canvas | HTML §15 interactive media |
| `unstyled-xml.ts` | Fallback DOM-tree view for XML documents without an applicable style sheet | HTML §15 unstyled XML documents |

The first useful slice is not a general layout engine. Add the HTML UA sheet
and presentational-hint source under `style/`, then define one box-tree query
that can truthfully answer “being rendered” for implemented content. Geometry,
Intersection Observer, focus visibility, `innerText`, paint timing, and
screenshots must wait for that real box boundary rather than infer layout from
DOM shape or computed `display` alone.

Replaced content consumes `loader/` and `graphics/`; nested frames consume
`browsing/`; widgets consume HTML form/interaction state. Rendering must not
take ownership of those subsystems merely because it visualizes them. A
headless embedder may omit an OS-native widget toolkit, but it still needs a
deterministic platform-independent rendering model for browser automation.

## Removal condition

Burn this file when UA style inputs, box construction, layout, replaced
content, widgets, print, and unstyled XML either have implemented source or a
narrower subsystem roadmap.
