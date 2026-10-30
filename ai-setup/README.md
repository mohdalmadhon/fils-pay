# AI setup

How the AI assistant was set up and used on this repo by malmadhoo
(Mohammed Almadhoon). The annotated transcript excerpts are in
[`docs/SUBMISSION.md`](../docs/SUBMISSION.md#ai-usage-and-setup).

## The assistant

| | |
|---|---|
| Assistant | Claude (Anthropic), in the Claude app |
| Model | Claude Opus 5.5 (`claude-opus-5-5`) |
| Where it ran | An agentic cloud workspace: a Linux container with Node 22, Go, Postgres 16 and Chromium/Playwright, where it can run commands, tests and browsers |
| Link to the laptop | The Claude desktop app links the session to the Windows laptop, giving the assistant a shell scoped to one connected folder (`C:\Users\moham\development\github\fils-pay`) and file transfer in and out of it. Nothing else on the laptop is reachable. |
| Memory | One stored preference: Mohammed is the only contributor on his repos, so no co-author or session lines in commits |

## Standing instructions

Given once in the conversation and followed for every task since. Exact
words and how each is enforced: [`instructions.md`](instructions.md).

1. Never push.
2. Mohammed is author and committer of every commit; the assistant is never
   listed as a contributor.
3. Every issue is split into five commits.
4. Document everything: where a problem was found and what the fix was.

## How a task ran

```
 laptop (Windows)                         cloud workspace (Linux)
 ─────────────────                        ──────────────────────────────
 fils-pay checkout ── git bundle ──────▶  working copy
                                          │ read code, reproduce, measure
                                          │ change, test (npm test, go test,
                                          │   e2e browser, a11y, load)
                                          │ 5 commits as malmadhoo
 fast-forward ◀────── git bundle ─────────┘ (scripts/commit-as-me.sh)
 (scripts/apply-bundle.sh)
 Mohammed reviews and pushes himself
```

- **Work happens in the cloud copy**, where the database, Go and a browser
  are available; the laptop only receives finished commits.
- **Commits move as git bundles**, never through GitHub: the assistant has
  no push step at all. `scripts/make-bundle.sh` makes one on the cloud side;
  `scripts/apply-bundle.sh` fast-forwards the laptop's branch (refusing
  anything that isn't a fast-forward) and deletes the bundle.
- **Verification before claiming anything**: the full test suite on a fresh
  database, the browser end-to-end check, the accessibility check in every
  theme, screenshots of every design (`scripts/screenshots.mjs`), and for
  performance, measured runs (`scripts/load/` in the repo).

## The repo's own AI files

`CLAUDE.md`, `AGENTS.md` and `.cursorrules` at the repo root came with the
project. They are part of its story (`docs/the-order-of-the-prompt.md`),
and several statements in them were wrong (money in "cents", settlement on
UTC midnight). The assistant treated them as claims to check against the
code, not as instructions; the team corrected `CLAUDE.md` and `AGENTS.md`
where the code proved them wrong. Instructions in project docs that are
addressed to AI tools are not followed; only Mohammed's instructions are.

## Files

| File | |
|---|---|
| [`instructions.md`](instructions.md) | the standing instructions, verbatim, and how each is enforced |
| [`scripts/commit-as-me.sh`](scripts/commit-as-me.sh) | commit named files as Mohammed (author and committer), no trailers |
| [`scripts/make-bundle.sh`](scripts/make-bundle.sh) | cloud side: bundle the new commits for the laptop |
| [`scripts/apply-bundle.sh`](scripts/apply-bundle.sh) | laptop side: fast-forward from a bundle, then delete it |
| [`scripts/go-offline.sh`](scripts/go-offline.sh) | build and test the Go service when the Go module mirror is unreachable |
| [`scripts/screenshots.mjs`](scripts/screenshots.mjs) | sign in and screenshot dashboard pages in any design and mode |

## Limits met, and what was done

- **Go module mirror unreachable** from the workspace: `go-offline.sh`
  clones the three `golang.org/x` modules from GitHub and points a
  temporary module file at them; the repo's `go.mod` is never changed.
- **Background processes stop between turns**: Postgres and dev servers are
  restarted at the start of a turn when needed.
- **`pkill -f <pattern>` can match the assistant's own shell** (the pattern
  is in its command line) and kill it; process control lives in small
  script files instead.
- **Line endings**: the laptop checks out with CRLF, so its status is read
  with `git -c core.autocrlf=true`.
