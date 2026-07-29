import type { ReactElement } from "react";
import Link from "next/link";

/** Top nav — plain links, no client state. */
export function Nav(): ReactElement {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link className="brand" href="/">
          PR Review Agent
        </Link>
        <nav className="nav" aria-label="Main">
          <Link href="/">Reviews</Link>
          <Link href="/hitl">HITL queue</Link>
          <Link href="/economics">Economics</Link>
        </nav>
      </div>
    </header>
  );
}
