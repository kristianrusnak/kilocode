// Generated/modified by AI Kilo Code, used model glm-5.3-flash
//
// Ported verbatim from canonical-kilo/git-normalizer/test/ (the algorithm source
// of truth): canonicalize.test.ts (29-row spec table), identity.test.ts
// (pass-through contract) and wrappers.test.ts — now running against the
// shipping module @/kilocode/permission/git-normalize.
import { describe, expect, test } from "bun:test"
import { normalizeCommand } from "@/kilocode/permission/git-normalize"

// TARGET canonical forms (from git-command-canonicalization.md).
// After canonicalization, a single
//   "bash": { "git push": "deny", "git commit": "deny" }
// rule must match every row below.
describe("29-row canonicalization table", () => {
  const cases: [raw: string, canonical: string][] = [
    // plain subcommand first (already catchable by git push*/git commit*)
    ["git push", "git push"],
    ["git push origin main", "git push"],
    ["git push -f", "git push -f"],
    ["git push --force origin main", "git push --force"],
    ["git push origin main --force", "git push --force"],
    ["git push --set-upstream origin main", "git push --set-upstream"],

    // global options / -C / wrappers before the subcommand (today need git *)
    ["git -C /tmp/repo push", "git push"],
    ["git -C /tmp/repo push origin main", "git push"],
    ["git -C /tmp/repo push -f", "git push -f"],
    ["git --git-dir=/tmp/repo/.git push", "git push"],
    ["git --work-tree=/tmp/repo push", "git push"],
    ["git -c user.name=ae push", "git push"],
    ["git --color=always push", "git push"],
    ["git --no-pager push", "git push"],
    ["git -P push", "git push"],
    ["command git push", "git push"],
    ["env git push", "git push"],
    ["/usr/bin/git push", "git push"],
    ["git.exe push", "git push"],

    // commit variants
    ["git commit", "git commit"],
    ["git commit -m \"x\"", "git commit -m \"x\""],
    ["git commit -am \"x\"", "git commit -am \"x\""],
    ["git commit --amend", "git commit --amend"],
    ["git commit --amend -m \"x\"", "git commit --amend -m \"x\""],
    ["git commit --no-verify -m \"x\"", "git commit --no-verify -m \"x\""],
    ["git -C /tmp/repo commit -m \"x\"", "git commit -m \"x\""],
    ["git -C /tmp/repo commit --amend", "git commit --amend"],
    ["git --git-dir=/tmp/repo/.git commit", "git commit"],
    ["git --color=always -C /tmp/repo push", "git push"],
  ]

  for (const [raw, canonical] of cases) {
    test(`${JSON.stringify(raw)} → ${JSON.stringify(canonical)}`, async () => {
      expect(await normalizeCommand(raw)).toBe(canonical)
    })
  }

  // Read-only git commands must survive canonicalization as `git <readonly>` so
  // deny rules for push/commit do not block them.
  test("read-only git commands still canonicalize to their subcommand", async () => {
    expect(await normalizeCommand("git log --oneline")).toBe("git log --oneline")
    expect(await normalizeCommand("git status")).toBe("git status")
    expect(await normalizeCommand("git -C /tmp/repo status")).toBe("git status")
  })
})

describe("pass-through contract", () => {
  test("non-git commands must pass through unchanged", async () => {
    expect(await normalizeCommand("npm install")).toBe("npm install")
    expect(await normalizeCommand("cat a.txt")).toBe("cat a.txt")
    expect(await normalizeCommand("ls -la")).toBe("ls -la")
  })

  test("git commands canonicalize (no longer identity)", async () => {
    expect(await normalizeCommand("git push")).toBe("git push")
    expect(await normalizeCommand("git -C /tmp/repo push")).toBe("git push")
    expect(await normalizeCommand("git commit -m \"x\"")).toBe("git commit -m \"x\"")
  })

  test("git without a subcommand passes through (fail closed)", async () => {
    expect(await normalizeCommand("git --version")).toBe("git --version")
    expect(await normalizeCommand("git -C /tmp/repo")).toBe("git -C /tmp/repo")
  })
})

describe("wrappers", () => {
  test("wrapper commands strip their own options and canonicalize git", async () => {
    expect(await normalizeCommand("sudo git push")).toBe("git push")
    expect(await normalizeCommand("sudo -u root git push")).toBe("git push")
    expect(await normalizeCommand("sudo -E -n git push -f")).toBe("git push -f")
    expect(await normalizeCommand("command git push")).toBe("git push")
    expect(await normalizeCommand("env git push")).toBe("git push")
    expect(await normalizeCommand("env -i git push")).toBe("git push")
    expect(await normalizeCommand("env VAR=1 git push")).toBe("git push")
    expect(await normalizeCommand("timeout 5s git push")).toBe("git push")
    expect(await normalizeCommand("nice -n 10 git push")).toBe("git push")
    expect(await normalizeCommand("nohup git push")).toBe("git push")
    expect(await normalizeCommand("time -p git push")).toBe("git push")
    expect(await normalizeCommand("xargs git commit")).toBe("git commit")
  })

  test("assignment prefixes are peeled before the command", async () => {
    expect(await normalizeCommand("VAR=1 git push")).toBe("git push")
    expect(await normalizeCommand("GIT_DIR=/repo git commit -m \"x\"")).toBe("git commit -m \"x\"")
    expect(await normalizeCommand("VAR=1 command git push")).toBe("git push")
  })

  test("bash -c wrapper re-parses the inner command", async () => {
    expect(await normalizeCommand("bash -c 'git push origin main'")).toBe("git push")
    expect(await normalizeCommand("bash -c \"git commit -m \\\"x\\\"\"")).toBe("git commit -m \"x\"")
    expect(await normalizeCommand("sh -c 'git push'")).toBe("git push")
    expect(await normalizeCommand("sudo bash -c \"git commit -m \\\"x\\\"\"")).toBe("git commit -m \"x\"")
    expect(await normalizeCommand("env -S \"git push origin main\"")).toBe("git push")
  })

  test("bash -c with a non-git inner command passes through unchanged", async () => {
    expect(await normalizeCommand("bash -c 'npm install'")).toBe("bash -c 'npm install'")
    expect(await normalizeCommand("sudo npm install")).toBe("sudo npm install")
  })

  test("git_command keeps subcommand flags", async () => {
    expect(await normalizeCommand("git log --oneline")).toBe("git log --oneline")
    expect(await normalizeCommand("git commit -am \"x\"")).toBe("git commit -am \"x\"")
    expect(await normalizeCommand("git push --set-upstream origin main")).toBe("git push --set-upstream")
  })

  test("nested command substitutions are not treated as separate commands", async () => {
    expect(await normalizeCommand("git -C \"$(pwd)\" push")).toBe("git push")
    expect(await normalizeCommand("git -C \"$(git rev-parse --show-toplevel)\" push")).toBe("git push")
  })

  test("env -u strips the variable, not its value", async () => {
    expect(await normalizeCommand("env -u FOO git push")).toBe("git push")
  })
})
