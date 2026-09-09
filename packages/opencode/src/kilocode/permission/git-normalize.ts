/**
 * Generated/modified by AI Kilo Code, used model glm-5.3-flash
 *
 * normalizeCommand — canonicalize a shell command STRING before Kilo Code matches
 * it against `permission.bash` deny/allow/ask rules.
 *
 * Shipping Kilo version of the experiment harness:
 *   canonical-kilo/git-normalizer/src/normalize.ts  (algorithm source of truth)
 * The git-extended tree-sitter-bash grammar (github:kristianrusnak/tree-sitter-bash
 * #git-extended, installed as @kilocode/tree-sitter-bash-git) is parsed at runtime,
 * mirroring how shell.ts loads the standard tree-sitter-bash grammar.
 */
import { Language, type Node, type Parser } from "web-tree-sitter"
import { fileURLToPath } from "url"

const resolveWasm = (asset: string) => {
  if (asset.startsWith("file://")) return fileURLToPath(asset)
  if (asset.startsWith("/") || /^[a-z]:/i.test(asset)) return asset
  return fileURLToPath(new URL(asset, import.meta.url))
}

let _parser: Promise<Parser> | undefined

/** Lazily builds one parser bound to the git-extended bash grammar. */
function gitBashParser(): Promise<Parser> {
  _parser ??= (async () => {
    const { Parser } = await import("web-tree-sitter")
    const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, {
      with: { type: "wasm" },
    })
    await Parser.init({ locateFile: () => resolveWasm(treeWasm) }) // no-op if shell.ts already ran
    const { default: gitBashWasm } = await import(
      "@kilocode/tree-sitter-bash-git/tree-sitter-bash.wasm" as string,
      { with: { type: "wasm" } },
    )
    const language = await Language.load(resolveWasm(gitBashWasm))
    const parser = new Parser()
    parser.setLanguage(language)
    return parser
  })()
  return _parser
}

export async function normalizeCommand(command: string): Promise<string> {
  // Fast path: a real git invocation always contains the token "git", so this
  // can never false-negative; it only avoids a wasted parse for non-git commands.
  if (!command.includes("git")) return command
  return canonicalize(command, await gitBashParser())
}

// ─────────────────────────────────────────────────────────────────────────
// The algorithm below is ported VERBATIM from canonical-kilo/git-normalizer/
// src/normalize.ts (see that file for the full design comments). Do not drift.
// ─────────────────────────────────────────────────────────────────────────

interface WrapperSpec {
  valueOpts?: ReadonlySet<string>
  boolOpts?: ReadonlySet<string>
  positional?: number
  assignments?: boolean
  commandStringOpts?: ReadonlySet<string>
}

const WRAPPERS: Record<string, WrapperSpec> = {
  sudo: {
    valueOpts: new Set(["-u", "--user", "-g", "--group"]),
    boolOpts: new Set(["-E", "-H", "-n", "-i"]),
  },
  command: {
    boolOpts: new Set(["-p"]),
  },
  env: {
    valueOpts: new Set(["-u", "--unset", "-C", "--chdir", "-P", "--path", "-a", "--argv0", "-S"]),
    boolOpts: new Set(["-i", "-v", "-0", "--ignore-environment", "--null"]),
    assignments: true,
    commandStringOpts: new Set(["-S"]),
  },
  timeout: {
    valueOpts: new Set(["-k", "--kill-after", "-s", "--signal"]),
    positional: 1,
  },
  nice: {
    valueOpts: new Set(["-n", "--adjustment"]),
  },
  ionice: {
    valueOpts: new Set(["-c", "-n", "-p", "-P", "-u", "--class", "--classdata", "--pid", "--uid"]),
  },
  chrt: {
    positional: 1,
  },
  stdbuf: {
    valueOpts: new Set(["-i", "-o", "-e"]),
  },
  nohup: {
    boolOpts: new Set(["-v"]),
  },
  xargs: {
    valueOpts: new Set(["-a", "-d", "-E", "-I", "-L", "-l", "-n", "-P", "-s", "--process-slot-var"]),
  },
  time: {
    boolOpts: new Set(["-p"]),
  },
  bash: { valueOpts: new Set(["-c"]), commandStringOpts: new Set(["-c"]) },
  sh: { valueOpts: new Set(["-c"]), commandStringOpts: new Set(["-c"]) },
  dash: { valueOpts: new Set(["-c"]), commandStringOpts: new Set(["-c"]) },
  zsh: { valueOpts: new Set(["-c"]), commandStringOpts: new Set(["-c"]) },
  ksh: { valueOpts: new Set(["-c"]), commandStringOpts: new Set(["-c"]) },
}

async function canonicalize(command: string, parser: Parser): Promise<string> {
  return (await canonicalizeResult(command, parser)).text
}

async function canonicalizeResult(command: string, parser: Parser): Promise<{ text: string; isGit: boolean }> {
  const tree = parser.parse(command)
  if (!tree) return { text: command, isGit: false }
  const nodes = collectNodes(tree.rootNode)
  if (nodes.length === 1) return canonicalizeNode(nodes[0], parser)
  return { text: command, isGit: false }
}

function collectNodes(root: Node): Node[] {
  const all = [
    ...root.descendantsOfType("command"),
    ...root.descendantsOfType("git_command"),
  ].filter((n): n is Node => n !== null)
  return all.filter((n) => !all.some((m) => m !== n && isAncestor(m, n)))
}

function isAncestor(ancestor: Node, node: Node): boolean {
  let p: Node | null = node.parent
  while (p) {
    if (p.id === ancestor.id) return true
    p = p.parent
  }
  return false
}

function canonicalizeNode(node: Node, parser: Parser): Promise<{ text: string; isGit: boolean }> {
  if (node.type === "git_command") {
    const canon = canonicalizeGitNode(node)
    return Promise.resolve({ text: canon ?? node.text, isGit: canon !== null })
  }
  if (node.type === "command") return canonicalizeGeneric(node, parser)
  return Promise.resolve({ text: node.text, isGit: false })
}

async function canonicalizeGeneric(node: Node, parser: Parser): Promise<{ text: string; isGit: boolean }> {
  const children = node.namedChildren.filter((c): c is Node => c !== null)
  if (children.length === 0) return { text: node.text, isGit: false }

  let idx = 0
  while (idx < children.length && children[idx].type === "variable_assignment") idx++
  if (idx >= children.length) return { text: node.text, isGit: false }
  const headChild = children[idx]
  const headName = basename(headChild.text)

  if (normalizeGitBinary(headChild.text) === "git") {
    const inner = "git" + node.text.slice(headChild.endIndex - node.startIndex)
    const result = await canonicalizeResult(inner, parser)
    if (result.isGit) return result
    return { text: node.text, isGit: false }
  }

  const spec = WRAPPERS[headName]
  if (!spec) return { text: node.text, isGit: false }

  let i = idx + 1
  let positional = spec.positional ?? 0
  while (i < children.length) {
    const child = children[i]
    const text = child.text

    if (spec.assignments && /^[A-Za-z_][A-Za-z0-9_]*=/.test(text)) {
      i++
      continue
    }
    if (spec.valueOpts?.has(text)) {
      if (spec.commandStringOpts?.has(text)) {
        const inner = i + 1 < children.length ? commandStringContent(children[i + 1]) : null
        if (inner === null) return { text: node.text, isGit: false }
        const result = await canonicalizeResult(inner, parser)
        if (result.isGit) return result
        return { text: node.text, isGit: false }
      }
      i += 2
      continue
    }
    if (spec.boolOpts?.has(text)) {
      i++
      continue
    }
    if (positional > 0) {
      positional--
      i++
      continue
    }
    break
  }

  if (i >= children.length) return { text: node.text, isGit: false }
  const inner = node.text.slice(children[i].startIndex - node.startIndex)
  const result = await canonicalizeResult(inner, parser)
  if (result.isGit) return result
  return { text: node.text, isGit: false }
}

function normalizeGitBinary(token: string): string | null {
  let s = token.trim()
  s = s.replace(/^["']|["']$/g, "")
  s = s.replace(/\\(.)/g, "$1")
  s = s.split(/[\\/]/).pop() ?? s
  if (s.endsWith(".exe")) s = s.slice(0, -4)
  return s === "git" ? "git" : null
}

function basename(token: string): string {
  let s = token.trim()
  s = s.replace(/^["']|["']$/g, "")
  s = s.replace(/\\(.)/g, "$1")
  return s.split(/[\\/]/).pop() ?? s
}

function canonicalizeGitNode(node: Node): string | null {
  const sub = node.childForFieldName("subcommand")
  if (!sub) return null

  const children = node.namedChildren.filter((c): c is Node => c !== null)
  const after = children.filter((c) => c.startIndex > sub.endIndex)
  const out = ["git", sub.text]

  for (let j = 0; j < after.length; j++) {
    const t = after[j].text
    if (!t.startsWith("-")) continue
    out.push(t)
    if (!t.startsWith("--") && j + 1 < after.length && !after[j + 1].text.startsWith("-")) {
      out.push(after[j + 1].text)
      j++
    }
  }
  return out.join(" ")
}

function commandStringContent(child: Node): string | null {
  switch (child.type) {
    case "string": {
      const content = child.namedChildren.find((c): c is Node => c !== null && c.type === "string_content")
      const raw = content !== undefined ? content.text : child.text.slice(1, -1)
      return raw.replace(/\\(["\\$`])/g, "$1")
    }
    case "raw_string":
      return child.text.slice(1, -1)
    case "ansi_c_string":
      return child.text.slice(2, -1)
    case "translated_string":
      return child.text.slice(2, -1)
    default:
      return child.text
  }
}
