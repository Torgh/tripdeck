import fs from "node:fs";
import path from "node:path";

/**
 * Notices when TripDeck's code on disk changed after a long-running process (the MCP server, which
 * Claude Code keeps running for days) loaded it: after a `git pull` the old server keeps the old code
 * and can misread trips the new app saved. It compares the newest modification time of the code
 * (lib/, mcp/, package.json) with the one at start, at most every `everyMs`.
 */
export function codeWatcher(root: string, { everyMs = 30_000, now = () => Date.now() } = {}) {
  const started = codeStamp(root);
  let checkedAt = now();
  let changed = false;
  return {
    /** True once the code on disk is newer than what this process runs. */
    changed(): boolean {
      if (changed || now() - checkedAt < everyMs) return changed;
      checkedAt = now();
      changed = codeStamp(root) > started;
      return changed;
    },
  };
}

/** The newest modification time of the code that decides how trips are read and written. */
export function codeStamp(root: string): number {
  let newest = 0;
  const visit = (file: string) => {
    try {
      newest = Math.max(newest, fs.statSync(file).mtimeMs);
    } catch {
      // removed meanwhile
    }
  };
  visit(path.join(root, "package.json"));
  for (const dir of ["lib", "mcp"]) {
    let names: string[] = [];
    try {
      names = fs.readdirSync(path.join(root, dir), { recursive: true }) as string[];
    } catch {
      continue;
    }
    for (const name of names) if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) visit(path.join(root, dir, name));
  }
  return newest;
}

export const STALE_NOTE =
  "⚠️ TripDeck's code changed on disk after this MCP server started (an update or a branch switch), so this server still runs the old version and may misread newer trips. Ask the user to restart it: in Claude Code /mcp → tripdeck → Reconnect (or restart Claude Desktop / Codex).";
