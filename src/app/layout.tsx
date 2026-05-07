import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Linkademy",
  description: "학원과 학생을 잇다.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" className="h-full">
      <head>
        {/* 다크 모드 깜빡임 방지: 페이지 렌더 전에 즉시 실행 */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{if(localStorage.getItem('linkademy-dark')==='1')document.documentElement.classList.add('dark')}catch(e){}})()` }} />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"
        />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
