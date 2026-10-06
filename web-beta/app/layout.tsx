import "./globals.css";

export const metadata = {
  title: "D.O.N.N.A. — AI Operating Layer",
  description: "Windows-first AI cockpit with voice, memory, research and local tools.",
};

export const viewport = {
  themeColor: "#03070b",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
