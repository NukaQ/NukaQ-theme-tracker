import type { Metadata, Viewport } from "next";
import Header from "@/components/Header";
import "./globals.css";

export const metadata: Metadata = {
  title: "テーマトラッカー｜米国株・日本株のテーマ別騰落率",
  description: "AI・半導体・防衛など、米国株と日本株の注目テーマの騰落率をランキングとマップで可視化します。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1116" },
  ],
};

// 色設定を描画前に反映して、ちらつきを防ぐ
const initScript = `try{var u=localStorage.getItem("tt:updown");if(u)document.documentElement.dataset.updown=u}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: initScript }} />
      </head>
      <body>
        <Header />
        <main className="main">{children}</main>
        <footer className="footer">
          掲載情報は投資判断の参考情報であり、特定銘柄の売買を推奨するものではありません。
          株価データは Yahoo Finance から取得しており、遅延や誤りを含む場合があります。
        </footer>
      </body>
    </html>
  );
}
