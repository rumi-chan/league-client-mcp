# League Client MCP — Claude Instructions

> **Claude Code** loads this file automatically.
> Full instructions are in `@AGENTS.md`.

@AGENTS.md

---

## Claude-Specific Notes

- Use `/lol-summoner/v1/current-summoner` to anchor the session before reading other player data.
- When the user asks to "build a plugin", always follow the 7-step workflow in AGENTS.md.
- Prefer `inject_lol_plugin` over `inject_lol_css` whenever JS logic is needed alongside CSS.
- After `export_plugin_to_pengu`, always call `reload_lol_client` to activate the export.
- The `.claude/rules/` directory can hold additional scoped rules if the project grows.
