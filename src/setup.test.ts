import { describe, expect, test } from "bun:test";
import { mergeProviderJsonc, stripJsonComments, hasComments } from "./setup.js";

const SNIPPET = `"commandcode": {\n    "name": "New"\n  }`;

describe("stripJsonComments / hasComments", () => {
  test("strips line and block comments, keeps strings", () => {
    const out = stripJsonComments('{"a": "x//y", "b": 1 /* c */} // trailing');
    expect(out).not.toContain("trailing");
    expect(out).not.toContain("/* c */");
    expect(out).toContain("x//y");
  });

  test("detects comments outside strings", () => {
    expect(hasComments('{"a": 1} // hi')).toBe(true);
    expect(hasComments('{"a": "x//y"}')).toBe(false);
    expect(hasComments('{"a": 1}')).toBe(false);
  });
});

describe("mergeProviderJsonc", () => {
  test("replaces existing block, preserves comments", () => {
    const raw = `{
  // top comment
  "providers": {
    // inner comment
    "commandcode": { "name": "Old" },
    "other": { "x": 1 }
  }
}`;
    const merged = mergeProviderJsonc(raw, SNIPPET)!;
    expect(merged).not.toBeNull();
    expect(merged).toContain("// top comment");
    expect(merged).toContain("// inner comment");
    expect(merged).toContain('"name": "New"');
    expect(merged).not.toContain('"name": "Old"');
    expect(merged).toContain('"other"');
  });

  test("inserts into existing providers without commandcode", () => {
    const raw = `{
  "providers": {
    "other": { "x": 1 }
  }
}`;
    const merged = mergeProviderJsonc(raw, SNIPPET)!;
    expect(merged).toContain(SNIPPET);
    expect(merged).toContain('"other"');
  });

  test("creates providers block when missing", () => {
    const raw = `{
  "$schema": "https://opencode.ai/config.json"
}`;
    const merged = mergeProviderJsonc(raw, SNIPPET)!;
    expect(merged).toContain('"providers"');
    expect(merged).toContain(SNIPPET);
  });

  test("returns null on unbalanced input", () => {
    expect(mergeProviderJsonc(`{ "providers": { "commandcode": { `, SNIPPET)).toBeNull();
  });
});
