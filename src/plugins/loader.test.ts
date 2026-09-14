import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { readPluginCommit } from "./loader";

const scratch: string[] = [];

function checkout(): string {
  const dir = mkdtempSync(join(tmpdir(), "gloom-plugin-"));
  scratch.push(dir);
  mkdirSync(join(dir, ".git", "refs", "heads"), { recursive: true });
  return dir;
}

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const SHA = "0123456789abcdef0123456789abcdef01234567";

/**
 * Read without spawning git, once per plugin at every startup. The three
 * layouts git actually writes are covered; anything else must come back null
 * rather than a wrong commit that the update check would then trust.
 */
describe("readPluginCommit", () => {
  test("reads a detached HEAD, which is what a pinned install leaves", () => {
    const dir = checkout();
    writeFileSync(join(dir, ".git", "HEAD"), `${SHA}\n`);
    expect(readPluginCommit(dir)).toBe(SHA);
  });

  test("follows a branch ref to its loose file", () => {
    const dir = checkout();
    writeFileSync(join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
    writeFileSync(join(dir, ".git", "refs", "heads", "main"), `${SHA}\n`);
    expect(readPluginCommit(dir)).toBe(SHA);
  });

  test("falls back to packed-refs after git gc", () => {
    const dir = checkout();
    writeFileSync(join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
    writeFileSync(join(dir, ".git", "packed-refs"), `# pack-refs with: peeled fully-peeled sorted\n${SHA} refs/heads/main\n`);
    expect(readPluginCommit(dir)).toBe(SHA);
  });

  test("is null for a folder that is not a checkout", () => {
    const dir = mkdtempSync(join(tmpdir(), "gloom-plain-"));
    scratch.push(dir);
    expect(readPluginCommit(dir)).toBeNull();
  });
});
