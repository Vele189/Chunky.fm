# FigJam Scrapbook agent

`figjam-scrapbook.md` is a Claude Code subagent definition. It is also readable as a plain style guide.

## Install

Pick one:

- **Every project, no copying:** `cp figjam-scrapbook.md ~/.claude/agents/`
- **One project, committed with the repo:** `mkdir -p <project>/.claude/agents && cp figjam-scrapbook.md <project>/.claude/agents/`

## Tell Claude to use it

Add this to the project's `CLAUDE.md`:

```md
## Research + plans on FigJam
When I share a figma.com/board link, or ask for research, a plan, a project map, or a new "layer" on a board,
use the `figjam-scrapbook` agent (or follow `.claude/agents/figjam-scrapbook.md` yourself).
Keep its hand-drawn scrapbook style, research before drawing, and always include a "things that look off" section.
```

## Example prompts

- `<board url> explain this repo: overview, objective, current state, data flow, infrastructure`
- `add a layer on the database tables and how they connect`
- `add a layer comparing the 3 auth options we discussed, with a recommendation`
- `plan the v2 migration as a scrapbook layer: steps, risks, open questions`

## Requirements

- The Figma MCP must be connected and authorized.
- The `figma-use` and `figma-use-figjam` skills must be available. Either the Figma plugin provides them, or the MCP serves them through `get_figma_skill`.
