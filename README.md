# A Knight's Errand — Series

Interactive animated storybooks, played as branching vertical video. Each
episode is a self-contained web game (static HTML/JS/video) — no build step,
no server-side code.

**Play:** open `index.html`, or the published GitHub Pages site, and choose
an episode.

## Episodes

| # | Title | Path |
|---|-------|------|
| Prologue | A Knight's Errand | `00-a-knights-errand/` |
| Errand I | The Dragon's Hoard | `01-the-dragons-hoard/` |
| Errand II | The Bell of the Drowned Abbey | `02-the-bell-of-the-drowned-abbey/` |

Each episode folder contains `index.html`, `main.js`, `style.css`, a
`manifest.json` describing the story tree, and its video `clips/`.

This repository holds only the published games. Production materials
(prompt pipelines, raw renders, reference art) live outside it.

## Local preview

```
python3 -m http.server 8000
```

Then open http://localhost:8000/.
