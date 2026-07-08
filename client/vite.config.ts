import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

/**
 * Vite 설정.
 * - PWA: 휴대폰 홈화면 추가 + 오프라인 셸. 카메라 접근을 위해 프로덕션은 HTTPS 필요.
 * - dev 프록시: 프론트는 항상 /api 만 호출하고, 실제 외부 API 키는 서버가 보관.
 */
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "명함 스캐너",
        short_name: "명함스캐너",
        description: "컨설턴트용 명함 스캔 → 구글 시트 저장",
        lang: "ko",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // API 응답은 캐시하지 않음(항상 최신 추출/저장)
        navigateFallbackDenylist: [/^\/api/],
      },
    }),
  ],
  server: {
    port: 5173,
    // 모바일 테스트 시 LAN 접속 허용(폰에서 노트북 IP 로 접근)
    host: true,
    // cloudflared/ngrok 등 터널 도메인 접속 허용(개발용)
    allowedHosts: true,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});
