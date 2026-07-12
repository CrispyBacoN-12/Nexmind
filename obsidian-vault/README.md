---
type: index
---

# NEXMIND Vault

Research notes, desk decisions, and backtest logs for the NEXMIND trading project — kept separate from the app code/DB, linked by markdown `[[wikilinks]]`.

Open this folder (`obsidian-vault/`) directly as an Obsidian vault: **Open folder as vault** → select `nexmind/obsidian-vault`.

## Structure

- `Strategies/` — one note per strategy (research or built-in): the logic, the reasoning, known weaknesses.
- `Backtests/` — dated blind-test / sweep results, so past runs don't need to be re-derived from scripts.
- `Desks/` — portfolio-level decisions (merges, archives, why a desk exists).
- `Journal/` — freeform dated notes; anything that doesn't fit the above yet.

## Suggested plugins

- **Dataview** — query notes by frontmatter (e.g. list all strategies with `status: approved`).
- **Smart Connections** or **Copilot for Obsidian** — chat over the vault with your own API key, if you want AI search across these notes.

This vault has no automated sync with the app — update it by hand (or ask Claude to write a note) when a decision is made.
