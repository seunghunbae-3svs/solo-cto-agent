import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const {
  detectRoutes,
  normalize,
  extractFromText,
  _isLikelyFilePath,
  _isBlacklistedFirstSegment,
} = require(
  "../templates/orchestrator/ops/lib/route-detection.js"
);

describe("route-detection: normalize", () => {
  it("leaves '/' as root", () => {
    expect(normalize("/")).toBe("/");
  });

  it("prepends slash when missing", () => {
    expect(normalize("pricing")).toBe("/pricing");
  });

  it("strips trailing slash", () => {
    expect(normalize("/pricing/")).toBe("/pricing");
  });

  it("collapses duplicate slashes", () => {
    expect(normalize("//foo//bar")).toBe("/foo/bar");
  });

  it("lowercases routes", () => {
    expect(normalize("/Pricing/Plans")).toBe("/pricing/plans");
  });

  it("rejects routes with invalid characters", () => {
    expect(normalize("/foo?bar=baz")).toBeNull();
    expect(normalize("/foo bar")).toBeNull();
    expect(normalize("/foo@bar")).toBeNull();
  });

  it("rejects file-like paths", () => {
    expect(normalize("/README.md")).toBeNull();
    expect(normalize("/src/foo.tsx")).toBeNull();
    expect(normalize("/package.json")).toBeNull();
  });

  it("rejects blacklisted first segments", () => {
    expect(normalize("/src/components/Button")).toBeNull();
    expect(normalize("/node_modules/foo")).toBeNull();
    expect(normalize("/.github/workflows")).toBeNull();
    expect(normalize("/api/users")).toBeNull();
  });

  it("accepts normal product routes", () => {
    expect(normalize("/pricing")).toBe("/pricing");
    expect(normalize("/blog/hello-world")).toBe("/blog/hello-world");
    expect(normalize("/dashboard/settings")).toBe("/dashboard/settings");
  });
});

describe("route-detection: extractFromText", () => {
  it("extracts routes from free-form prose", () => {
    const text = "Fixes the button on /pricing and /checkout pages.";
    expect(extractFromText(text)).toEqual(["/pricing", "/checkout"]);
  });

  it("extracts from markdown link-ish text", () => {
    const text = "Updated [dashboard](/dashboard) and the /settings page.";
    const out = extractFromText(text);
    expect(out).toContain("/dashboard");
    expect(out).toContain("/settings");
  });

  it("extracts multi-segment routes", () => {
    const text = "Bug fix on /account/billing/invoices.";
    expect(extractFromText(text)).toContain("/account/billing/invoices");
  });

  it("ignores file paths mentioned inline", () => {
    const text = "Edited /src/pages/Index.tsx and /README.md.";
    expect(extractFromText(text)).toEqual([]);
  });

  it("returns empty for text with no route-like tokens", () => {
    expect(extractFromText("No paths here, just prose.")).toEqual([]);
  });

  it("ignores empty / nullish input", () => {
    expect(extractFromText("")).toEqual([]);
    expect(extractFromText(null)).toEqual([]);
    expect(extractFromText(undefined)).toEqual([]);
  });
});

describe("route-detection: detectRoutes", () => {
  it("always includes '/' first", () => {
    const routes = detectRoutes({ title: "Fix homepage bug", body: "" });
    expect(routes[0]).toBe("/");
  });

  it("combines title + body + issueBody", () => {
    const routes = detectRoutes({
      title: "Fix /pricing",
      body: "Also affects /checkout",
      issueBody: "See /blog/welcome too",
    });
    expect(routes).toContain("/");
    expect(routes).toContain("/pricing");
    expect(routes).toContain("/checkout");
    // Capped at max=3 by default, so /blog/welcome may not make it
    expect(routes.length).toBeLessThanOrEqual(3);
  });

  it("caps at max=3 by default", () => {
    const ctx = {
      title: "Updates to /a /b /c /d /e /f",
      body: "",
    };
    const routes = detectRoutes(ctx);
    expect(routes.length).toBeLessThanOrEqual(3);
  });

  it("respects custom max option", () => {
    const ctx = { title: "/a /b /c /d /e", body: "" };
    const routes = detectRoutes(ctx, { max: 2 });
    expect(routes).toEqual(["/", "/a"]);
  });

  it("dedupes duplicate routes across fields", () => {
    const ctx = {
      title: "/pricing fix",
      body: "also /pricing breakage",
      issueBody: "/pricing is broken",
    };
    const routes = detectRoutes(ctx);
    const pricingCount = routes.filter((r) => r === "/pricing").length;
    expect(pricingCount).toBe(1);
  });

  it("returns just '/' when no routes mentioned", () => {
    const routes = detectRoutes({
      title: "Refactor internal util",
      body: "No user-facing changes.",
    });
    expect(routes).toEqual(["/"]);
  });

  it("handles missing ctx fields gracefully", () => {
    expect(detectRoutes({})).toEqual(["/"]);
    expect(detectRoutes({ title: null, body: undefined })).toEqual(["/"]);
  });

  it("skips API routes and source paths", () => {
    const routes = detectRoutes({
      title: "Fix /api/users endpoint",
      body: "Edit /src/handlers.ts and /components/Button.tsx",
    });
    expect(routes).toEqual(["/"]);
  });
});

describe("route-detection: internal helpers", () => {
  it("_isLikelyFilePath detects common extensions", () => {
    expect(_isLikelyFilePath("/foo.md")).toBe(true);
    expect(_isLikelyFilePath("/foo.tsx")).toBe(true);
    expect(_isLikelyFilePath("/foo")).toBe(false);
    expect(_isLikelyFilePath("/foo/bar.json")).toBe(true);
  });

  it("_isBlacklistedFirstSegment detects known non-route dirs", () => {
    expect(_isBlacklistedFirstSegment("/src/foo")).toBe(true);
    expect(_isBlacklistedFirstSegment("/api/users")).toBe(true);
    expect(_isBlacklistedFirstSegment("/pricing")).toBe(false);
    expect(_isBlacklistedFirstSegment("/")).toBe(false);
  });
});
