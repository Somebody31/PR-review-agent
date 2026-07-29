"use server";

import { revalidatePath } from "next/cache";
import { approveHitl, disputeFinding, rejectHitl } from "@/lib/api";

/**
 * Server actions for HITL / dispute mutations.
 * Token never leaves the server.
 */

export type ActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export async function approveHitlAction(
  hitlId: string,
): Promise<ActionResult> {
  try {
    await approveHitl(hitlId);
    revalidatePath("/hitl");
    revalidatePath("/");
    return { ok: true, message: "Approved and posted (or reused existing post)." };
  } catch (error: unknown) {
    return { ok: false, message: errorMessage(error) };
  }
}

export async function rejectHitlAction(
  hitlId: string,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const commentRaw = formData.get("comment");
    const comment =
      typeof commentRaw === "string" && commentRaw.trim().length > 0
        ? commentRaw.trim()
        : undefined;
    await rejectHitl(hitlId, comment);
    revalidatePath("/hitl");
    revalidatePath("/");
    return { ok: true, message: "Rejected without posting to GitHub." };
  } catch (error: unknown) {
    return { ok: false, message: errorMessage(error) };
  }
}

export async function disputeFindingAction(
  findingId: string,
  reviewId: string,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const commentRaw = formData.get("comment");
    const comment =
      typeof commentRaw === "string" && commentRaw.trim().length > 0
        ? commentRaw.trim()
        : undefined;
    await disputeFinding(findingId, comment);
    revalidatePath(`/reviews/${reviewId}`);
    return { ok: true, message: "Dispute recorded (no auto prompt change)." };
  } catch (error: unknown) {
    return { ok: false, message: errorMessage(error) };
  }
}
