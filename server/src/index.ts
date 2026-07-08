import express from "express";
import cors from "cors";
import { env, corsOrigins } from "./env.js";
import { scanRouter } from "./routes/scan.js";
import { saveRouter } from "./routes/save.js";

/**
 * Express 진입점(스캐폴드).
 * - 현재는 헬스체크만 노출합니다.
 * - 다음 단계에서 /api/scan(추출), /api/save(시트 저장) 라우터를 여기에 mount 합니다.
 */
const app = express();

app.use(
  cors({
    origin: corsOrigins,
  }),
);
app.use(express.json({ limit: "1mb" }));

/** 헬스체크: 서버/환경 로딩 확인용 */
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    env: env.NODE_ENV,
    // 어떤 외부 연동이 "설정"됐는지만 노출(값은 절대 노출하지 않음)
    integrations: {
      anthropic: Boolean(env.ANTHROPIC_API_KEY),
      clovaOcr: Boolean(env.CLOVA_OCR_INVOKE_URL && env.CLOVA_OCR_SECRET_KEY),
      googleSheets: Boolean(
        env.GOOGLE_SHEETS_CLIENT_EMAIL &&
          env.GOOGLE_SHEETS_PRIVATE_KEY &&
          env.GOOGLE_SHEETS_SPREADSHEET_ID,
      ),
    },
  });
});

// 명함 인식(sharp → Claude Vision → CLOVA → Zod)
app.use("/api/scan", scanRouter);
// 인식 결과 → Google Sheets 저장
app.use("/api/save", saveRouter);

app.listen(env.PORT, () => {
  console.log(`🚀 server listening on http://localhost:${env.PORT}`);
});
