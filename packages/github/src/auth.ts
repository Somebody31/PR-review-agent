import { App } from "@octokit/app";
import type { PullsOctokit } from "./pr-context.js";

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
 * Installation-scoped client for PR/repo API calls.
 */
export async function getInstallationOctokit(
  app: App,
  installationId: number,
): Promise<PullsOctokit> {
  const octokit = await app.getInstallationOctokit(installationId);
  // App typings omit the REST plugin surface; runtime still exposes .rest.pulls / .rest.repos
  return octokit as unknown as PullsOctokit;
}
