"use client";

import { useState, useTransition, type ReactElement } from "react";
import { disputeFindingAction, type ActionResult } from "@/app/actions";

/** Small form to dispute a single finding (feedback only). */
export function DisputeForm(props: {
  findingId: string;
  reviewId: string;
}): ReactElement {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData): void {
    startTransition(async () => {
      const next = await disputeFindingAction(
        props.findingId,
        props.reviewId,
        formData,
      );
      setResult(next);
    });
  }

  return (
    <div className="stack" style={{ marginTop: "0.75rem" }}>
      <form action={onSubmit} className="row-actions">
        <input
          type="text"
          name="comment"
          placeholder="Why is this finding wrong? (optional)"
          disabled={pending}
        />
        <button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Dispute"}
        </button>
      </form>
      {result ? (
        <div className={result.ok ? "flash flash-ok" : "flash flash-error"}>
          {result.message}
        </div>
      ) : null}
    </div>
  );
}
