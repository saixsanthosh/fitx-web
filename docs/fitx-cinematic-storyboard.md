# FITX Cinematic Entrance — Storyboard

**Runtime:** about 6.2 seconds; session-once, immediately skippable.
**Visual language:** one charcoal / warm-white architectural studio, restrained coral light, soft contact shadows, brushed metal and tactile rubber / knit. Only the existing Skip control remains visible over the animation.

| Time | Image and action | Camera / transition | Sound |
| --- | --- | --- | --- |
| 0.0–1.35s | A running shoe hangs just above the studio floor. The sole compresses on contact, laces and upper follow with restrained secondary movement; a slim coral reflection travels along the sole. | Low three-quarter tracking shot eases into a close side detail; a gentle arc gives the upper and tread parallax. | Off. No audio is requested for the first implementation. |
| 1.35–1.85s | The tread / sole becomes a frame-filling surface, then resolves on the circular sidewall and spokes of a bicycle wheel. | A short, fast camera pass hides the cut. The camera emerges through spokes and pulls back into the cycle scene; no repeated dissolve. | Off. |
| 1.85–3.35s | A complete road bicycle is grounded in the same studio. Both wheels turn together, the crank and pedals complete a believable rotation, and the frame catches a narrow softbox reflection. | A measured side tracking move with a restrained orbit, followed by a deliberate move toward the front wheel. | Off. |
| 3.35–4.85s | Circular rim detail match-cuts to a weight plate. A single loaded bar lifts under control and settles, with visible rack, knurl, collars, contact shadow and floor reflection. | Camera travels through the circular plate silhouette and pulls back to a balanced training-rig portrait; the lift is driven by one eased action. | Off. |
| 4.85–6.2s | The studio light sweeps inward and the equipment falls into shadow. The untouched FITX mark and coded wordmark resolve crisp and monochrome at the focal point. | A final centered dolly settles on the brand; the rendered studio clears into the already server-rendered homepage with a short opacity handoff. | Off. |

### Mobile composition

Use a taller lens framing, bring each subject nearer the optical center, reduce render pixel ratio, disable depth-of-field postprocessing, and keep the top-right Skip target inside safe areas. No horizontal camera sweep should crop the primary subject.

### Theme and failure behavior

Light uses a warm-white studio with graphite equipment and restrained coral accents. Dark uses a charcoal studio, lifted warm highlights, the same coral, and the same logo geometry. Reduced-motion, low-power, and WebGL-failure paths use a brief static brand treatment, then expose the SSR homepage; Escape and Skip end playback immediately.

### Transition implementation notes

Use fast camera moves and frame-filling geometry to motivate match cuts. Let the subject that is leaving occlude the next subject, then pull back to reveal the next scene. The final brand mark is rendered by the approved SVG component, not a traced or regenerated approximation. Avoid generic progress UI, scene labels, and a slideshow-like crossfade cadence.
