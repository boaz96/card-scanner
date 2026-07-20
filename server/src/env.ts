import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

/**
 * 환경변수 로드 + 검증.
 * - 루트의 .env 를 읽습니다.
 *   npm 워크스페이스로 실행하면 cwd 가 server/ 가 되므로, 루트(../)까지 위로 올라가며 .env 를 탐색합니다.
 * - 필수/선택 키를 zod 로 검증해, 누락 시 서버가 "명확한 메시지"와 함께 즉시 종료됩니다.
 * - 모든 외부 API 키는 여기(서버)에서만 접근합니다. 프론트 번들에는 절대 포함되지 않습니다.
 */
for (const candidate of [
  resolve(process.cwd(), ".env"), // 루트에서 실행
  resolve(process.cwd(), "../.env"), // server/ 에서 실행(npm workspace)
  resolve(process.cwd(), "../../.env"), // dist/src 등에서 실행
]) {
  if (existsSync(candidate)) {
    loadDotenv({ path: candidate });
    break;
  }
}

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),

  // Anthropic Claude Vision (1차 추출) — 스캐폴드 단계에선 선택. 다음 단계에서 필수화.
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5"),

  // Naver CLOVA OCR (2차 폴백)
  // .env 에 빈 값("")으로 남겨둔 경우 미설정(undefined)으로 취급해 URL 검증을 건너뜀
  CLOVA_OCR_INVOKE_URL: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().url().optional(),
  ),
  CLOVA_OCR_SECRET_KEY: z.string().optional(),
  USE_OCR_FALLBACK: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  // 키 발급 전 목데이터로 2차 OCR 경로를 배선·검증하기 위한 모의 모드
  CLOVA_OCR_MOCK: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  // Google Sheets (서비스 계정)
  GOOGLE_SHEETS_CLIENT_EMAIL: z.string().optional(),
  GOOGLE_SHEETS_PRIVATE_KEY: z.string().optional(),
  GOOGLE_SHEETS_SPREADSHEET_ID: z.string().optional(),
  GOOGLE_SHEETS_TAB_NAME: z.string().default("명함"),
  // Workspace 공유 드라이브 ID(설정 시 새 시트를 이 드라이브에 생성·목록 조회)
  GOOGLE_SHARED_DRIVE_ID: z.string().optional(),
  // 회사 Workspace 도메인(예: gainge.com). "회사 전체 공유" 옵션에 사용.
  GOOGLE_WORKSPACE_DOMAIN: z.string().optional(),
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
