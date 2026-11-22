import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { codeStamp, codeWatcher } from "./codeVersion";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "tripdeck-code-"));
const write = (rel: string, at: number) => {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "x");
  fs.utimesSync(file, at / 1000, at / 1000);
};

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("codeWatcher", () => {
  it("notices newer code on disk, not tests or other files, at most every interval", () => {
    const t0 = Date.UTC(2026, 0, 1);
    write("package.json", t0);
    write("lib/types.ts", t0);
    write("mcp/server.ts", t0);
    expect(codeStamp(root)).toBe(t0);

    let clock = 0;
    const watcher = codeWatcher(root, { everyMs: 1000, now: () => clock });
    write("lib/types.test.ts", t0 + 60_000);
    write("docs/readme.md", t0 + 60_000);
    clock = 2000;
    expect(watcher.changed()).toBe(false);

    write("lib/server/maps.ts", t0 + 60_000);
    clock = 2500;
    expect(watcher.changed()).toBe(false); // checked less than a second ago
    clock = 3500;
    expect(watcher.changed()).toBe(true);
  });
});
