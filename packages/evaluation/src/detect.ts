import type { EvalFixture } from "./types.js";

/**
 * Deterministic offline detectors for golden fixtures.
 * These stand in for agents in CI so `pnpm eval` needs no API keys.
 * Pattern coverage is intentionally narrow (fixture set only).
 */
export function detectCategories(fixture: EvalFixture): string[] {
  const text = fixtureText(fixture);
  const found: string[] = [];

  if (looksLikeSqlInjection(text)) {
    found.push("injection");
  }
  if (looksLikeSecretLeak(text)) {
    found.push("secret-leak");
  }
  if (looksLikeMissingTest(fixture)) {
    found.push("missing-test");
  }
  if (looksLikeEmptyCatch(text)) {
    found.push("empty-catch");
  }
  if (looksLikeDocsGap(fixture)) {
    found.push("docs-gap");
  }
  if (looksLikePathTraversal(text)) {
    found.push("path-traversal");
  }

  return found;
}

function fixtureText(fixture: EvalFixture): string {
  const parts: string[] = [fixture.title, fixture.body ?? ""];
  for (const file of fixture.files) {
    parts.push(file.path);
    parts.push(file.patch);
  }
  return parts.join("\n");
}

function looksLikeSqlInjection(text: string): boolean {
  // Added line with SQL + string concat of user input
  const added = addedLines(text);
  for (const line of added) {
    if (/SELECT|INSERT|UPDATE|DELETE/i.test(line) && /\+\s*\w+/.test(line)) {
      return true;
    }
  }
  return false;
}

function looksLikeSecretLeak(text: string): boolean {
  if (/\bsk-(live|test)?-?[A-Za-z0-9]{16,}\b/.test(text)) {
    return true;
  }
  if (/\b(apiKey|api_key|secret|password)\s*[:=]\s*["'][^"']{8,}["']/.test(text)) {
    return true;
  }
  return false;
}

/**
 * New non-test source file with logic but no companion test file in the PR.
 * Scoped by title keywords so unrelated golden diffs do not all flag missing-test.
 * Must not hardcode fixture ids — that would make the golden gate circular.
 */
function looksLikeMissingTest(fixture: EvalFixture): boolean {
  const titleLooksLikeHelper =
    /discount|pricing|helper/i.test(fixture.title);
  if (!titleLooksLikeHelper) {
    return false;
  }

  let hasLogicSource = false;
  let hasTestFile = false;

  for (const file of fixture.files) {
    const path = file.path;
    if (/\.(test|spec)\./.test(path) || path.includes("__tests__")) {
      hasTestFile = true;
      continue;
    }
    if (/\.(ts|js|tsx|jsx)$/.test(path) && !path.includes("docs")) {
      const added = addedLines(file.patch);
      for (const line of added) {
        if (/function |export |class |=>/.test(line)) {
          hasLogicSource = true;
          break;
        }
      }
    }
  }

  return hasLogicSource && !hasTestFile;
}

function looksLikeEmptyCatch(text: string): boolean {
  // catch (...) { } with nothing inside on following lines
  if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(text)) {
    return true;
  }
  // Multi-line empty catch in unified diff
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (!line.startsWith("+")) {
      continue;
    }
    if (/catch\s*\(/.test(line)) {
      const next = lines[i + 1] ?? "";
      if (next.trim() === "+}" || next.trim() === "+  }") {
        return true;
      }
    }
  }
  return false;
}

function looksLikeDocsGap(fixture: EvalFixture): boolean {
  let exposesPublicApi = false;
  let hasDocChange = false;

  for (const file of fixture.files) {
    if (/README|docs\//i.test(file.path) || file.path.endsWith(".md")) {
      hasDocChange = true;
    }
    const patch = file.patch;
    if (/\/v\d+\//.test(patch) || /public.*route|registerPublic/i.test(patch + file.path)) {
      exposesPublicApi = true;
    }
  }

  return exposesPublicApi && !hasDocChange;
}

function looksLikePathTraversal(text: string): boolean {
  const added = addedLines(text);
  for (const line of added) {
    const touchesFsOrUpload =
      /uploads|readFile|createReadStream|join\s*\(/.test(line);
    const usesUserishInput =
      /\+\s*\w+/.test(line) || /\$\{/.test(line) || /name|userPath|filename/.test(line);
    const hasSanitize =
      /path\.normalize|sanitize|basename/.test(line);

    if (touchesFsOrUpload && usesUserishInput && !hasSanitize) {
      return true;
    }
  }
  return false;
}

function addedLines(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      out.push(line.slice(1));
    }
  }
  return out;
}
