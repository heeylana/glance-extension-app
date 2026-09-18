import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * WXT's shadow-root loader lifts `@property` and `@font-face` blocks out of content-script CSS with a
 * regex that runs to the next closing brace, comments included. One such word in a comment removed
 * the bubble's `:host` token block in the unminified dev build, so every token colour fell back to
 * black; the production build strips comments and hid it.
 */
describe("content-script CSS", () => {
  const dir = new URL("../../entrypoints/content/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".css"));

  it.each(files)("%s has no at-rule WXT would cut out of the shadow root", (file) => {
    expect(readFileSync(new URL(file, dir), "utf8")).not.toMatch(/@(property|font-face)/);
  });
});
