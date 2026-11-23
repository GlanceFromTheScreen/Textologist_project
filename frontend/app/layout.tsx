import type { Metadata } from "next";
import "./globals.css";
import Navbar from "@/components/Navbar";

export const metadata: Metadata = {
  title: "Textologist+",
  description: "Сравнение текстов и анализ разночтений",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="bg-slate-50 text-slate-900 min-h-screen flex flex-col">
        {/* We will conditionally render Navbar inside pages or check auth, 
            but for simplicity let's put a global layout wrapper. 
            However, login page might not need navbar. 
            Let's keep it simple: Navbar is client component that checks auth/route.
        */}
        <Navbar />
        <main className="flex-grow">
            {children}
        </main>
        <footer className="py-6 text-center text-slate-400 text-sm">
            © 2026 Textologist+. Все права защищены.
        </footer>
      </body>
    </html>
  );
}
