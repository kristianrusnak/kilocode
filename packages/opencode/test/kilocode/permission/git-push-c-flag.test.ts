// Generated/modified by AI Kilo Code 7.5.6-gratex-017, used model glm-5.3-flash
// (verbatim copy of canonical-kilo/git-push-c-flag.test.ts, placed here for the test run)
//
// Regression test for the `git -C <path> push|commit` permission gap.
//
// Context: `permission.bash` patterns are matched with anchored, full-string
// wildcard matching (see src/util/wildcard.ts). A rule like `"git push": "deny"`
// compiles to `^git push$` and therefore only matches the literal string
// `git push` — never `git push origin main`, and never `git -C /tmp/repo push`.
//
// Agents running shell commands against a repo other than the session workdir
// (e.g. `git -C /path/to/repo push`) therefore bypass the exact deny rules.
// These tests lock in the current behaviour AND verify the recommended fix
// patterns.

import { test, expect, describe } from "bun:test"
import { Permission } from "../../../src/permission"

// The exact deny rules as written in e.g. roo-common `.kilo/kilo.jsonc`.
const exactRules = Permission.fromConfig({
  bash: {
    "git commit": "deny",
    "git push": "deny",
  },
})

// Broad deny-all-git style used by readOnlyBash (ask/plan agents) with read-only exceptions.
const gitStarRules = Permission.fromConfig({
  bash: {
    "git *": "deny",
    "git log *": "allow",
    "git status *": "allow",
  },
})

// Recommended fix: wildcard suffix + explicit `-C <path>` variants.
const withCVariants = Permission.fromConfig({
  bash: {
    "git commit*": "deny",
    "git push*": "deny",
    "git -C * commit*": "deny",
    "git -C * push*": "deny",
  },
})

describe("exact `git commit` / `git push` rules (no wildcard) — the gap", () => {
  test("`git push origin main` is NOT denied", () => {
    expect(Permission.evaluate("bash", "git push origin main", exactRules).action).toBe("ask")
  })

  test("`git -C /tmp/repo push` is NOT denied", () => {
    expect(Permission.evaluate("bash", "git -C /tmp/repo push", exactRules).action).toBe("ask")
  })

  test("`git commit -m x` is NOT denied", () => {
    expect(Permission.evaluate("bash", "git commit -m x", exactRules).action).toBe("ask")
  })

  test("`git -C /tmp/repo commit -m x` is NOT denied", () => {
    expect(Permission.evaluate("bash", "git -C /tmp/repo commit -m x", exactRules).action).toBe("ask")
  })
})

describe("broad `git *` deny (readOnlyBash-style) catches `-C`", () => {
  test("`git -C /tmp/repo push` IS denied", () => {
    expect(Permission.evaluate("bash", "git -C /tmp/repo push", gitStarRules).action).toBe("deny")
  })

  test("`git push origin main` IS denied", () => {
    expect(Permission.evaluate("bash", "git push origin main", gitStarRules).action).toBe("deny")
  })

  test("`git log --oneline` stays allowed (exception)", () => {
    expect(Permission.evaluate("bash", "git log --oneline", gitStarRules).action).toBe("allow")
  })
})

describe("exact + `-C` variants (recommended fix)", () => {
  test("`git -C /tmp/repo push` IS denied", () => {
    expect(Permission.evaluate("bash", "git -C /tmp/repo push", withCVariants).action).toBe("deny")
  })

  test("`git -C /tmp/repo commit -m x` IS denied", () => {
    expect(Permission.evaluate("bash", "git -C /tmp/repo commit -m x", withCVariants).action).toBe("deny")
  })

  test("`git push origin main` IS denied", () => {
    expect(Permission.evaluate("bash", "git push origin main", withCVariants).action).toBe("deny")
  })

  test("`git commit -m x` IS denied", () => {
    expect(Permission.evaluate("bash", "git commit -m x", withCVariants).action).toBe("deny")
  })

  test("read-only `git log --oneline` is not denied (falls back to ask)", () => {
    expect(Permission.evaluate("bash", "git log --oneline", withCVariants).action).toBe("ask")
  })
})

// `git * push *` is a seductive-looking deny rule but has subtle semantics.
// Because of the trailing ` *` → `( .*)?` special case in Wildcard.match, the
// regex becomes `^git .* push( .*)?$`: it requires the literal token ` push`
// to appear AFTER the first `.*`. That means the bare `git push` and the
// common `git push origin main` do NOT match (the `.* push` needs a second,
// space-separated token after the first `*`). It DOES catch `git -C <path>
// push`, but also false-positives on `git stash push` / `git remote push`.
describe("`git * push *` semantics", () => {
  const rules = Permission.fromConfig({ bash: { "git * push *": "deny" } })
  const action = (cmd: string) => Permission.evaluate("bash", cmd, rules).action

  test("matches `git -C /tmp/repo push`", () => {
    expect(action("git -C /tmp/repo push")).toBe("deny")
  })

  test("matches `git -C /tmp/repo push origin main`", () => {
    expect(action("git -C /tmp/repo push origin main")).toBe("deny")
  })

  test("does NOT match bare `git push` (missing `.*` token before ` push`)", () => {
    expect(action("git push")).toBe("ask")
  })

  test("does NOT match `git push origin main`", () => {
    expect(action("git push origin main")).toBe("ask")
  })

  test("false positive: matches `git stash push`", () => {
    expect(action("git stash push")).toBe("deny")
  })

  test("false positive: matches `git remote push`", () => {
    expect(action("git remote push")).toBe("deny")
  })
})
