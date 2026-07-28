/**
 * One changed file in a PR, with optional patch and head content.
 */
export type PrFile = {
  path: string;
  status: string;
  patch?: string;
  content?: string;
};

/**
 * Everything the worker needs to review a pull request.
 */
export type PrContext = {
  owner: string;
  repo: string;
  prNumber: number;
  title: string;
  body: string;
  headSha: string;
  baseSha: string;
  files: PrFile[];
};

/** Minimal Octokit surface used by fetchPrContext (easy to mock in tests). */
export type PullsOctokit = {
  rest: {
    pulls: {
      get: (args: {
        owner: string;
        repo: string;
        pull_number: number;
      }) => Promise<{
        data: {
          title: string;
          body: string | null;
          head: { sha: string };
          base: { sha: string };
        };
      }>;
      listFiles: (args: {
        owner: string;
        repo: string;
        pull_number: number;
        per_page: number;
      }) => Promise<{
        data: Array<{
          filename: string;
          status: string;
          patch?: string;
        }>;
      }>;
    };
    repos: {
      getContent: (args: {
        owner: string;
        repo: string;
        path: string;
        ref: string;
      }) => Promise<{
        data:
          | {
              type?: string;
              content?: string;
              encoding?: string;
            }
          | Array<unknown>;
      }>;
    };
  };
};

/**
 * Map GitHub listFiles rows into our PrFile shape (no network).
 */
export function mapGithubFiles(
  files: Array<{ filename: string; status: string; patch?: string }>,
): PrFile[] {
  const result: PrFile[] = [];
  for (const file of files) {
    const mapped: PrFile = {
      path: file.filename,
      status: file.status,
    };
    if (file.patch) {
      mapped.patch = file.patch;
    }
    result.push(mapped);
  }
  return result;
}

/**
 * Decode a base64 GitHub content payload to utf8 text.
 */
export function decodeGithubFileContent(base64Content: string): string {
  return Buffer.from(base64Content, "base64").toString("utf8");
}

/**
 * Fetch PR metadata, changed files (with patches), and file text at head when small enough.
 */
export async function fetchPrContext(
  octokit: PullsOctokit,
  args: {
    owner: string;
    repo: string;
    prNumber: number;
  },
): Promise<PrContext> {
  const prResponse = await octokit.rest.pulls.get({
    owner: args.owner,
    repo: args.repo,
    pull_number: args.prNumber,
  });

  const filesResponse = await octokit.rest.pulls.listFiles({
    owner: args.owner,
    repo: args.repo,
    pull_number: args.prNumber,
    per_page: 100,
  });

  const files = mapGithubFiles(filesResponse.data);
  const headSha = prResponse.data.head.sha;

  // Load file bodies for non-deleted files so agents can read more than the patch
  for (const file of files) {
    if (file.status === "removed") {
      continue;
    }
    const content = await tryFetchFileContent(octokit, {
      owner: args.owner,
      repo: args.repo,
      path: file.path,
      ref: headSha,
    });
    if (content !== null) {
      file.content = content;
    }
  }

  return {
    owner: args.owner,
    repo: args.repo,
    prNumber: args.prNumber,
    title: prResponse.data.title,
    body: prResponse.data.body ?? "",
    headSha,
    baseSha: prResponse.data.base.sha,
    files,
  };
}

async function tryFetchFileContent(
  octokit: PullsOctokit,
  args: { owner: string; repo: string; path: string; ref: string },
): Promise<string | null> {
  try {
    const response = await octokit.rest.repos.getContent({
      owner: args.owner,
      repo: args.repo,
      path: args.path,
      ref: args.ref,
    });

    const data = response.data;
    // Directory listing is an array — skip
    if (Array.isArray(data)) {
      return null;
    }
    if (data.type && data.type !== "file") {
      return null;
    }
    if (!data.content || data.encoding !== "base64") {
      return null;
    }

    const text = decodeGithubFileContent(data.content.replace(/\n/g, ""));
    // Cap huge files so we do not blow worker memory
    const maxChars = 200_000;
    if (text.length > maxChars) {
      return text.slice(0, maxChars);
    }
    return text;
  } catch {
    // Content is optional: 404/binary/permission errors must not fail the whole PR load
    return null;
  }
}
