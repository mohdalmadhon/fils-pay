# 15: Vulnerable dependencies

| | |
|---|---|
| **Severity** | High (sharp; pgx, still open) |
| **Status** | npm side fixed (5 commits, not pushed). **Go side open:** pgx needs Go 1.25, see [Not fixed](#not-fixed-pgx-go-settlement). |
| **Component** | `package-lock.json`, `apps/api`, `apps/web`, `apps/admin`, `apps/settlement/go.mod` |
| **Found** | `npm audit` and advisory lookups during the security review, 2026-10-30 |

## What was wrong

`npm audit --omit=dev` found 5 vulnerable production packages:

| Package | Was | Severity | Advisories |
|---|---|---|---|
| sharp | 0.33.5 | **High** | bundled libvips, libheif, librsvg CVEs (GHSA-f88m-g3jw-g9cj, GHSA-rgj7-g3m4-5g8c, GHSA-wq5f-xc86-pv6w). sharp decodes merchant-uploaded KYC images. |
| fastify | 5.12.3 | Moderate | GHSA-4mh8-r7rc-xpvc, GHSA-389g-gv7q-r4x8 |
| fast-uri | 3.x | Moderate | 7 advisories on host and scheme normalisation |
| react-router / react-router-dom | 6.30 | Moderate | GHSA-wrjc-x8rr-h8h6 (open redirect via backslash), GHSA-337j-9hxr-rhxg. No patched 6.x. |

## Fix

| # | Commit | What |
|---|---|---|
| 1 | `deps: update fastify and fast-uri to patched versions` | Lockfile only (fastify 5.12.7). |
| 2 | `deps: upgrade sharp to 0.35.5 for the libvips, libheif and librsvg fixes` | Major bump; one type import in a test changed. |
| 3 | `deps: upgrade react-router-dom to 7.18.5 in web and admin` | Major bump; no code changes were needed. |
| 4 | `deps: add npm run audit:prod` | `npm audit --omit=dev --audit-level=moderate`. |
| 5 | `docs: cyper 15, vulnerable dependencies` | This file. |

## Verified

- `npm run audit:prod`: **found 0 vulnerabilities**.
- `npm run typecheck` (all workspaces) is clean.
- API suites around KYC, onboarding and admin pass with sharp 0.35.5.
- Web and admin: `vite build` succeeds, and web tests pass 8/8.
- A headless browser loaded `/`, `/dashboard`, `/pay/:token`, the 404 page and
  both login pages of the built apps with no console errors.

**After pulling, run `npm install`.** sharp ships new prebuilt binaries,
including for Windows.

## Not fixed: pgx (Go settlement)

`apps/settlement` uses `github.com/jackc/pgx/v5 v5.7.2`, which is affected by:

- **CVE-2026-33816** (GO-2026-4772): memory-safety bug (CWE-787), fixed in
  **5.9.0**. Rated critical (CVSS 9.8).
- **CVE-2026-41889**: SQL injection via placeholder confusion in dollar-quoted
  literals, fixed in **5.9.2**. Only applies with the non-default simple
  protocol. Settlement doesn't use it (no `QueryExecModeSimpleProtocol` or
  `prefer_simple_protocol` anywhere), so this one doesn't apply today.

Every pgx 5.9.x release requires **Go 1.25**. The build machine here has Go
1.24.7 and can't download a newer toolchain or modules from `golang.org`, so
the upgrade couldn't be built or tested. It was not committed blind. To do it
on a machine with Go 1.25 or later:

```bash
cd apps/settlement
go get github.com/jackc/pgx/v5@v5.9.2
go mod tidy
go vet ./... && go test ./...
```

`go get` raises the `go` line in `go.mod` to 1.25. Any build image for
settlement must then use Go 1.25 or later. `ops/Dockerfile.go`, which compose
refers to, isn't in the repo.

`golang.org/x/crypto v0.31.0` (indirect, through pgx) also has later fixes, but
those affect `ssh` packages that settlement doesn't use. `go mod tidy` after the
pgx bump will raise it anyway.

Sources: [CVE-2026-33816 (GitLab advisory)](https://advisories.gitlab.com/golang/github.com/jackc/pgx/v5/CVE-2026-33816/),
[CVE-2026-33816 (Mend)](https://mend.io/vulnerability-database/CVE-2026-33816/),
[CVE-2026-41889](https://www.cvelogic.com/cve/CVE-2026-41889).
