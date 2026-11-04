# Design notes

## Direction

**Quiet industrial / editorial.** The interface uses a graphite-and-forest palette with a restrained copper accent. It should feel like a considered examination product, not a sci-fi SOC command console or a generic SaaS landing page.

The layout is intentionally typographic and task-led: one configuration panel on the start screen, a compact question map beside the active question, and a clear results ledger after submission. Most information is separated with rules and spacing rather than wrapping every element in a floating card.

## Patterns intentionally avoided

- No purple/cyan mesh gradients, neon glows, blur panels, or decorative glassmorphism.
- No repeated six-card feature grid, stock-photo hero, floating 3D decoration, or oversized icon tiles.
- No pill-shaped everything, excessive shadows, gradient text, or bounce/elastic hover animation.
- No decorative charts that do not convey a useful result.

## Interaction principles

- Progress, answered state, timer, and review flags remain visible during the exam.
- The user can navigate freely, change an answer, and mark a question for review.
- The interface does not disclose correctness until submission.
- A submit confirmation makes unanswered questions explicit before the irreversible action.
- The question map reduces the need to remember which questions have been answered.
- Keyboard shortcuts support efficient navigation, while visible controls remain available.
- Answer options can be shuffled per session; displayed letters follow the shuffled position, and the two source-note items keep their PDF order so the notes stay accurate.
- Focus moves to the question heading on navigation, the submit dialog traps focus and restores it on close, and timer/answer changes are announced through a polite live region.
- Long scenarios are stored as an explicit `scenario` + `ask` pair instead of being split by a runtime heuristic.
- Text never drops below 11px, the muted label tier meets WCAG AA on every surface it is used on, and interactive targets are at least 44×44px on touch devices.
- The stylesheet respects `prefers-reduced-motion` and limits animation to short state transitions.

## Source integrity

The question text, options, and supplied answer letters are represented in `src/data/questions.json`. Two source issues are surfaced in the app rather than being silently normalized: Q16's printed key conflicts with its explanation; Q77 has no printed answer and uses a labelled inference.

## References consulted

- [Impeccable frontend-design skill](https://github.com/daskoon/impeccable/blob/main/source/skills/frontend-design/SKILL.md)
- [Impeccable anti-pattern catalogue](https://subclaude.com/slop/)
- [InterfaceKit: What makes a website look AI-generated?](https://blog.interfacekit.io/what-makes-a-website-look-ai-generated)
- [Nielsen Norman Group: 10 usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/)
- [W3C WAI: Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions)
- [Vite: Deploying a static site to GitHub Pages](https://vite.dev/guide/static-deploy)
