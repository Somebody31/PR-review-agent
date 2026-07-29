import type { EvalFixture } from "./types.js";

/**
 * Offline golden set: intentional issues in synthetic diffs.
 * Detectors in detect.ts must find these categories without calling an LLM.
 */
export const FIXTURES: EvalFixture[] = [
  {
    id: "sql-injection",
    title: "Add user lookup by id",
    body: "quick user fetch",
    files: [
      {
        path: "src/users.ts",
        status: "modified",
        patch: [
          "@@ -10,3 +10,6 @@",
          " export function findUser(id: string) {",
          '-  return db.query("SELECT * FROM users WHERE id = $1", [id]);',
          '+  // intentional SQL string concat for fixture',
          '+  return db.query("SELECT * FROM users WHERE id = \'" + id + "\'");',
          " }",
        ].join("\n"),
      },
    ],
    expectedCategories: ["injection"],
  },
  {
    id: "hardcoded-secret",
    title: "Wire payment client",
    files: [
      {
        path: "src/payments.ts",
        status: "added",
        patch: [
          "@@ -0,0 +1,5 @@",
          "+export const stripeClient = {",
          '+  apiKey: "sk-live-abcdefghijklmnopqrstuvwxyz12",',
          "+  charge: () => undefined,",
          "+};",
        ].join("\n"),
      },
    ],
    expectedCategories: ["secret-leak"],
  },
  {
    id: "missing-test",
    title: "Add discount helper",
    files: [
      {
        path: "src/pricing.ts",
        status: "added",
        patch: [
          "@@ -0,0 +1,6 @@",
          "+export function applyDiscount(price: number, pct: number): number {",
          "+  if (pct < 0 || pct > 100) throw new Error('bad pct');",
          "+  return price * (1 - pct / 100);",
          "+}",
        ].join("\n"),
      },
    ],
    expectedCategories: ["missing-test"],
  },
  {
    id: "empty-catch",
    title: "Swallow errors on cache read",
    files: [
      {
        path: "src/cache.ts",
        status: "modified",
        patch: [
          "@@ -20,4 +20,8 @@",
          " export async function readCache(key: string) {",
          "+  try {",
          "+    return await redis.get(key);",
          "+  } catch (e) {",
          "+  }",
          " }",
        ].join("\n"),
      },
    ],
    expectedCategories: ["empty-catch"],
  },
  {
    id: "docs-gap",
    title: "Expose public API endpoint",
    files: [
      {
        path: "src/routes/public.ts",
        status: "added",
        patch: [
          "@@ -0,0 +1,8 @@",
          "+export function registerPublicRoutes(app: any) {",
          '+  app.get("/v2/report", async (c: any) => {',
          "+    return c.json(await buildReport());",
          "+  });",
          "+}",
        ].join("\n"),
      },
    ],
    expectedCategories: ["docs-gap"],
  },
  {
    id: "path-traversal",
    title: "Serve user uploads by name",
    files: [
      {
        path: "src/files.ts",
        status: "modified",
        patch: [
          "@@ -5,2 +5,6 @@",
          " export function readUpload(name: string) {",
          '+  const path = "/var/uploads/" + name;',
          "+  return fs.readFileSync(path);",
          " }",
        ].join("\n"),
      },
    ],
    expectedCategories: ["path-traversal"],
  },
];
