// PR-G7-impl — prompt-utils helpers extracted from bin/wizard.js.

import { describe, it, expect } from "vitest";
import {
  isTTY,
  ask,
  askYesNo,
  askChoice,
  createRl,
} from "../bin/prompt-utils.js";

// Minimal fake readline interface — only implements `.question()` for tests.
function fakeRl(answers) {
  let i = 0;
  return {
    question: (_q, cb) => {
      const next = answers[i++];
      queueMicrotask(() => cb(next == null ? "" : String(next)));
    },
  };
}

describe("isTTY", () => {
  it("returns a boolean", () => {
    expect(typeof isTTY()).toBe("boolean");
  });
});

describe("ask", () => {
  it("returns trimmed user input", async () => {
    const rl = fakeRl(["  hello  "]);
    expect(await ask(rl, "q")).toBe("hello");
  });

  it("falls back to default on empty input", async () => {
    const rl = fakeRl([""]);
    expect(await ask(rl, "q", "fallback")).toBe("fallback");
  });

  it("handles non-string answers gracefully", async () => {
    const rl = fakeRl([null]);
    expect(await ask(rl, "q", "fb")).toBe("fb");
  });
});

describe("askYesNo", () => {
  it("accepts y / yes (case-insensitive)", async () => {
    expect(await askYesNo(fakeRl(["y"]), "q")).toBe(true);
    expect(await askYesNo(fakeRl(["YES"]), "q")).toBe(true);
  });

  it("rejects other inputs", async () => {
    expect(await askYesNo(fakeRl(["nope"]), "q")).toBe(false);
  });

  it("uses defaultYes on empty answer", async () => {
    expect(await askYesNo(fakeRl([""]), "q", true)).toBe(true);
    expect(await askYesNo(fakeRl([""]), "q", false)).toBe(false);
  });
});

describe("askChoice", () => {
  it("returns a valid numeric choice", async () => {
    expect(await askChoice(fakeRl(["2"]), "q", 4)).toBe(2);
  });

  it("re-prompts on invalid input until valid", async () => {
    const rl = fakeRl(["nonsense", "10", "3"]);
    expect(await askChoice(rl, "q", 4)).toBe(3);
  });

  it("honors defaultChoice on empty input", async () => {
    expect(await askChoice(fakeRl([""]), "q", 4, 1)).toBe(1);
  });
});

describe("createRl", () => {
  it("returns an object with a close() method", () => {
    const rl = createRl();
    expect(typeof rl.close).toBe("function");
    rl.close();
  });
});
