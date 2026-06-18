# Isometric department-room art

The Roster is a **lobby of department rooms** → click a room to go inside and see
that team's members. Each department can have its own room art:

Drop **`public/office/<team>.png`** (lowercase team name) and it becomes that
department's room background automatically. Until then a CSS placeholder
(iso floor + world-tree + candle glow) is shown.

```
public/office/trading.png      public/office/dev.png
public/office/design.png       public/office/intelligence.png
public/office/finance.png      public/office/systems.png
public/office/content.png      public/office/hq.png
```

- Size: **1600×1000 px** (16:10), PNG. Pixel-art looks best (rendered crisp via `image-rendering: pixelated`).
- The agent characters are overlaid by the app on top — so design the room with
  **clear desk/table zones** roughly where the app places teams (below). Leave the
  desks empty (the app draws the little characters on them).

## Zone layout (where the app puts each team, % of image)

```
                 HQ (50,14)
   Intelligence(20,30)        Dev(80,30)
                Trading(50,47)
   Design(17,64)               Systems(83,64)
        Content(36,80)   Finance(64,80)
```

Tune these in `src/components/office/iso-office.tsx` (the `ZONES` map) to match
your art exactly.

## Generation prompt (Codex CLI / image model) — per department room

Generate one image per department (16:10, 1600×1000, pixel-art). Base prompt,
swap the « theme » per team:

> Isometric pixel-art room, 16:10, 2:1 isometric angle. A chamber inside the
> great world-tree **Yggdrasil** — glowing emerald leaves and golden runes,
> living-wood walls, floating candles and rune-lights, warm gold + deep green
> cyber-fantasy palette. « THEME ». Empty desks/chairs (characters added
> separately by the app). Crisp pixel-art, no text, no people.

| team | « THEME » |
|---|---|
| Trading | glowing market charts on crystal screens, a central altar-desk, gold coins |
| Dev | a dwarven forge with rune-engraved terminals and glowing anvils |
| Design | a bright airy elven studio with easels, color crystals, soft light |
| Intelligence | a library well of knowledge, scrolls, a scrying pool, star maps |
| Finance | a treasure hall with gold ledgers, vaults, coin stacks |
| Systems | a giants' hall of ancient machinery, gears, stone runes |
| Content | a cozy scriptorium with quills, parchment, printing runes |
| HQ | a throne-room study at the top of the tree, commanding view |

## Optional: per-agent pixel sprites

Drop `public/agents/<codename>.png` (e.g. `hawk.png`) — a small pixel character
sprite — to replace the auto-generated one for that agent. Prompt idea:

> 32×32 pixel-art character sprite of a [role], front-facing, [theme], wizard-
> fantasy, transparent background, no text.
