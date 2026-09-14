export const metadata = {
  title: "TrashLab Control Plane",
  description: "Fleet registry, version drift, and CI/deploy status across every tenant.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: "#f6f7f9",
          color: "#14181f",
          font: "14px/1.5 ui-sans-serif, -apple-system, 'Segoe UI', sans-serif",
        }}
      >
        {children}
      </body>
    </html>
  );
}
