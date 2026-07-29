"use client";

import { useState, useTransition, type ReactElement } from "react";
import {
  approveHitlAction,
  rejectHitlAction,
  type ActionResult,
} from "@/app/actions";

/**
 * Client buttons for HITL approve/reject so we can show inline result text.
 * Mutations still run on the server via server actions.
 */
export function HitlActions(props: {
  hitlId: string;
  state: string;
}): ReactElement {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const isPending = props.state === "pending";

  function onApprove(): void {
    startTransition(async () => {
      const next = await approveHitlAction(props.hitlId);
      setResult(next);
    });
  }

  function onReject(formData: FormData): void {
    startTransition(async () => {
      const next = await rejectHitlAction(props.hitlId, formData);
      setResult(next);
    });
  }

  if (!isPending) {
    return (
      <span className="lead" style={{ margin: 0 }}>
        No actions (state: {props.state})
      </span>
    );
  }

  return (
    <div className="stack">
      <div className="row-actions">
        <button
          type="button"
          className="primary"
          disabled={pending}
          onClick={onApprove}
        >
          {pending ? "Working…" : "Approve & post"}
        </button>
      </div>
      <form action={onReject} className="row-actions">
        <input
          type="text"
          name="comment"
          placeholder="Optional reject comment"
          disabled={pending}
        />
        <button type="submit" className="danger" disabled={pending}>
          Reject
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
