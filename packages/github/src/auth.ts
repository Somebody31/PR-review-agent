import { App } from "@octokit/app";
import type { ReviewsOctokit } from "./post-review.js";
import type { PullsOctokit } from "./pr-context.js";

/**
 * Installation client: fetch surface + post surface (same runtime Octokit).
 * createReview lives only on ReviewsOctokit (post-review.ts).
 */
export type InstallationOctokit = PullsOctokit & ReviewsOctokit;

/**
 * Normalize PEM text from env (env files often store newlines as "\n").
 */
export function normalizePrivateKey(privateKey: string): string {
  return privateKey.replace(/\\n/g, "\n");
}

/**
 * Build a GitHub App client from App ID + private key.
 */
export function createGithubApp(appId: string, privateKey: string): App {
  if (!appId || !privateKey) {
    throw new Error("GITHUB_APP_ID and GITHUB_PRIVATE_KEY are required");
  }

  return new App({
    appId,
    privateKey: normalizePrivateKey(privateKey),
  });
}

/**
 * Installation-scoped client for PR/repo API calls (fetch + post review).
 */
export async function getInstallationOctokit(
  app: App,
  installationId: number,
): Promise<InstallationOctokit> {
  const octokit = await app.getInstallationOctokit(installationId);
  // App typings omit the REST plugin surface; runtime still exposes .rest.pulls / .rest.repos
  return octokit as unknown as InstallationOctokit;
}
