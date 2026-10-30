# Standing instructions to the assistant

Given by Mohammed in the conversation, in his words, and followed on every
task after.

| # | Instruction, verbatim | How it is enforced |
|---|---|---|
| 1 | "do not push." | The assistant never runs `git push`. Commits reach the laptop as git bundles (`scripts/make-bundle.sh`, `scripts/apply-bundle.sh`) and Mohammed pushes. |
| 2 | "and also do not include yourself in the Contributors" | No `Co-Authored-By`, session or review trailer lines in any commit message, even when the tooling or a project document asks for them. Also kept as a stored memory preference. |
| 3 | "commit but I need to be the commiter" | `scripts/commit-as-me.sh` sets both author and committer to `malmadhoo <mohammedalmadhoon000@gmail.com>`. After each set of commits the assistant prints `git log --format='%an %cn'` and checks for trailers (`grep -ci 'co-authored'` must be 0). |
| 4 | "from now on. every issue I need 5 commits. so devide the commits how ever it should be under my name and not claude name." | Each issue is split into five commits that each make sense alone: typically the test or measurement first, then the changes in logical parts, then the documentation. |
| 5 | "fix all these issues but remember to document everything and where u found the issue and what was the fix" | Every fix has a write-up (`docs/improvements/`, `docs/cyper/`, `docs/merges/`, `docs/perf/`) giving where it was found, what was wrong, the fix and how it was verified, plus a CHANGELOG entry. |

## Working rules the assistant kept

Not given as instructions, but how it worked on this repo:

- **Measure, don't assume.** A claim about speed, correctness or a cause is
  backed by a run, a query plan, a log or a failing test, and that
  evidence goes into the write-up. When a claim turned out to be wrong, the
  write-up says so (`docs/perf/checkout-capacity.md`, "Corrections").
- **Prove a test catches the bug**: run it against the broken code and see
  it fail before the fix (for example the service-roles test failing with
  "permission denied" before the grant was added).
- **Fresh database for the full suite**, so leftovers from earlier runs
  can't hide or fake a failure.
- **Ask only when a wrong guess is expensive** (which branch a design goes
  on, the server's hardware for a capacity estimate); otherwise take the
  sensible default and say so.
