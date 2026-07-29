import type { Metadata } from "next";
import type { ReactElement, ReactNode } from "react";
import { Nav } from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "PR Review Agent",
  description: "Ops dashboard for AI PR reviews, HITL, traces, and cost",
};

export default function RootLayout(props: {
  children: ReactNode;
}): ReactElement {
  return (
    <html lang="en">
      <body>
        <Nav />
        <main>{props.children}</main>
      </body>
    </html>
  );
}
