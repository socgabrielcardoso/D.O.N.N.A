import "./globals.css";

export const metadata = {
  title: "D.O.N.N.A. Web Beta",
  description: "Cloud companion for D.O.N.N.A. Windows AI Operating Layer",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
