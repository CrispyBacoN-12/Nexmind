# Agent portraits

Drop a real portrait here named `<codename>.png` (lowercase) to override the
auto-generated avatar. Examples:

```
public/agents/hawk.png
public/agents/sage.png
public/agents/aria.png
```

- Recommended: square image, 256×256 or larger, transparent or dark background.
- If a file is missing, the app auto-generates a unique character portrait from
  DiceBear (style "adventurer") seeded by the codename — so it always looks like
  a person, never just an icon.
- If you change a file, hard-refresh the browser (avatars are cached).

## Generating real portraits

Use any image generator (your Codex CLI image step, Midjourney, etc.). Keep a
consistent style so the roster feels like one guild. Suggested prompts:

| codename | role | prompt seed |
|---|---|---|
| ARIA | Grand Secretary | "elegant strategist, cyberpunk fantasy portrait, calm, emerald accents" |
| HAWK | Market Intel | "sharp-eyed analyst, sky prophet, gold-market spear, confident" |
| SAGE | Risk Manager | "stoic guardian, balance-keeper, shield motif, wise" |
| SCANNER | Market Watcher | "techno sentinel with radar visor, watchful, teal glow" |
| BLADE | Trade Executor | "steel executor, katana, decisive, dark armor" |
| SCOUT | Research Lead | "recon scout, satellite lens, curious explorer" |

Save each as `public/agents/<codename>.png`. The change is picked up instantly.
