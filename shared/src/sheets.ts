import { z } from "zod";

/**
 * Google Sheets 대상 지정/생성/탭 관련 공통 스키마.
 * - 서버 라우터 검증과 클라이언트 API 래퍼가 동일 계약을 공유합니다.
 */

/** 탭 이름 규칙(구글 시트 제약: 1~100자, 일부 문자 제외는 서버에서 추가 검증) */
export const tabNameSchema = z.string().trim().min(1).max(100);

/** 스프레드시트 메타(제목 + 탭 목록) */
export const sheetMetaSchema = z.object({
  ok: z.literal(true),
  spreadsheetId: z.string(),
  title: z.string(),
  spreadsheetUrl: z.string().url(),
  tabs: z.array(z.string()),
});
export type SheetMeta = z.infer<typeof sheetMetaSchema>;

/** 새 스프레드시트 생성 요청 */
export const createSheetRequestSchema = z.object({
  title: z.string().trim().min(1).max(100),
  /** 지정 시 이 Google 계정에 편집자로 공유(서비스계정이 만든 파일을 사용자가 열 수 있게) */
  shareWithEmail: z.string().email().optional(),
  /** true 면 회사 도메인 전체(GOOGLE_WORKSPACE_DOMAIN)에 편집자로 공유 */
  shareWithDomain: z.boolean().optional(),
});
export type CreateSheetRequest = z.infer<typeof createSheetRequestSchema>;

/** 새 탭 추가 요청 */
export const addTabRequestSchema = z.object({
  /** 생략 시 서버 기본 스프레드시트(.env) 사용 */
  spreadsheetId: z.string().optional(),
  title: tabNameSchema,
});
export type AddTabRequest = z.infer<typeof addTabRequestSchema>;

/** 공유 드라이브 내 스프레드시트 목록 항목 */
export const sheetSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type SheetSummary = z.infer<typeof sheetSummarySchema>;

/** 시트 목록 응답(공유 드라이브 설정 시 팀 시트 목록) */
export const sheetListSchema = z.object({
  ok: z.literal(true),
  /** 공유 드라이브가 설정되어 목록 조회가 가능한지 */
  sharedDriveConfigured: z.boolean(),
  sheets: z.array(sheetSummarySchema),
});
export type SheetList = z.infer<typeof sheetListSchema>;

/** URL 또는 ID 문자열에서 스프레드시트 ID 추출(클라이언트/서버 공용 헬퍼) */
export function parseSpreadsheetId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // 전체 URL 형태: .../d/<ID>/edit
  const urlMatch = trimmed.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (urlMatch && urlMatch[1]) return urlMatch[1];
  // 이미 ID 만 붙여넣은 경우(영숫자/-/_ 로만 구성, 20자 이상)
  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed;
  return null;
}
