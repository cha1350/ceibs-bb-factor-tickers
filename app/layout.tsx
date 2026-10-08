import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "FactorLab | Stock research workspace",
  description:
    "Universe-relative factor scoring and constrained hypothetical stock portfolio allocation.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
