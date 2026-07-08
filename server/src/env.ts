import { config as loadDotenv } from "dotenv";
import { z } from "zod";

/**
 * 환경변수 로드 + 검증.
 * - 루트의 .env 를 읽습니다(모노레포 루트에서 실행 가정).
 * - 필수/선택 키를 zod 로 검증해, 누락 시 서버가 "명확한 메시지"와 함께 즉시 종료됩니다.
 * - 모든 외부 API 키는 여기(서버)에서만 접근합니다. 프론트 번들에는 절대 포함되지 않습니다.
 */
loadDotenv();

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),

  // Anthropic Claude Vision (1차 추출) — 스캐폴드 단계에선 선택. 다음 단계에서 필수화.
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-3-5-sonnet-latest"),

  // Naver CLOVA OCR (2차 폴백)
  CLOVA_OCR_INVOKE_URL: z.string().url().optional(),
  CLOVA_OCR_SECRET_KEY: z.string().optional(),
  USE_OCR_FALLBACK: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),

  // Google Sheets (서비스 계정)
  GOOGLE_SHEETS_CLIENT_EMAIL: z.string().optional(),
  GOOGLE_SHEETS_PRIVATE_KEY: z.string().optional(),
  GOOGLE_SHEETS_SPREADSHEET_ID: z.string().optional(),
  GOOGLE_SHEETS_TAB_NAME: z.string().default("명함"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // 어떤 환경변수가 왜 잘못됐는지 사람이 읽을 수 있게 출력하고 종료
  console.error("❌ 환경변수 검증 실패:");
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;

/** CORS 허용 오리진 목록 (콤마 구분 지원) */
export const corsOrigins = env.CORS_ORIGIN.split(",").map((s) => s.trim());
