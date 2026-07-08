import { google, type sheets_v4 } from "googleapis";
import {
  SHEET_HEADERS,
  SHEET_LAST_COLUMN,
  cardToSheetRow,
  findDuplicateRows,
  type BusinessCard,
  type DuplicateAction,
  type SaveCardResponse,
} from "@card-scanner/shared";
import { env } from "../env.js";
import { AppError } from "../errors.js";

/**
 * Google Sheets API v4 저장 서비스(서비스 계정 인증).
 * - 인증정보는 서버 환경변수에서만 로드합니다.
 * - 최초 1회 헤더 자동 생성, 이메일/(회사+이름) 중복 처리, append/update 를 담당합니다.
 */

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

interface SheetsContext {
  sheets: sheets_v4.Sheets;
  spreadsheetId: string;
}

/** 시트 설정 여부 */
export function isSheetsConfigured(): boolean {
  return Boolean(
    env.GOOGLE_SHEETS_CLIENT_EMAIL &&
      env.GOOGLE_SHEETS_PRIVATE_KEY &&
      env.GOOGLE_SHEETS_SPREADSHEET_ID,
  );
}

export function spreadsheetUrl(): string {
  return `https://docs.google.com/spreadsheets/d/${env.GOOGLE_SHEETS_SPREADSHEET_ID}/edit`;
}

/** 인증된 sheets 클라이언트 + spreadsheetId 준비 */
function getContext(): SheetsContext {
  const clientEmail = env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const privateKey = env.GOOGLE_SHEETS_PRIVATE_KEY;
  const spreadsheetId = env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!clientEmail || !privateKey || !spreadsheetId) {
    throw new AppError(
      "SHEETS_NOT_CONFIGURED",
      500,
      "구글 시트 저장이 설정되지 않았습니다. 관리자에게 문의해 주세요.",
    );
  }
  const auth = new google.auth.JWT({
    email: clientEmail,
    // .env 에 한 줄로 저장된 private_key 의 \n 이스케이프를 실제 줄바꿈으로 복원
    key: privateKey.replace(/\\n/g, "\n"),
    scopes: SCOPES,
  });
  return { sheets: google.sheets({ version: "v4", auth }), spreadsheetId };
}

/** 탭 이름을 A1 표기에 안전하게 인용 */
function a1(range: string): string {
  const tab = env.GOOGLE_SHEETS_TAB_NAME.replace(/'/g, "''");
  return `'${tab}'!${range}`;
}

/** google 호출을 표준 에러로 감싸기 */
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    // 권한 미공유(403)·시트 없음(404) 등 자주 나오는 케이스 안내
    if (msg.includes("403") || msg.toLowerCase().includes("permission")) {
      throw new AppError(
        "SHEETS_PERMISSION",
        502,
        "시트에 접근 권한이 없습니다. 서비스 계정 이메일을 시트에 편집자로 공유했는지 확인해 주세요.",
      );
    }
    throw new AppError(
      "SHEETS_FAILED",
      502,
      "구글 시트 저장 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
    );
  }
}

/** 최초 1회 헤더 행 보장 */
async function ensureHeader(ctx: SheetsContext): Promise<void> {
  const res = await guard(() =>
    ctx.sheets.spreadsheets.values.get({
      spreadsheetId: ctx.spreadsheetId,
      range: a1("1:1"),
    }),
  );
  const existing = res.data.values?.[0] ?? [];
  const mismatch =
    existing.length < SHEET_HEADERS.length ||
    SHEET_HEADERS.some((h, i) => String(existing[i] ?? "") !== h);

  if (mismatch) {
    await guard(() =>
      ctx.sheets.spreadsheets.values.update({
        spreadsheetId: ctx.spreadsheetId,
        range: a1(`A1:${SHEET_LAST_COLUMN}1`),
        valueInputOption: "RAW",
        requestBody: { values: [[...SHEET_HEADERS]] },
      }),
    );
  }
}

/** 데이터 행(2행부터) 조회 → 문자열 2차원 배열 */
async function getDataRows(ctx: SheetsContext): Promise<string[][]> {
  const res = await guard(() =>
    ctx.sheets.spreadsheets.values.get({
      spreadsheetId: ctx.spreadsheetId,
      range: a1(`A2:${SHEET_LAST_COLUMN}`),
    }),
  );
  const values = res.data.values ?? [];
  return values.map((row) => row.map((cell) => String(cell ?? "")));
}

/** append 결과 updatedRange 에서 행 번호 추출 (예: 'Sheet'!A5:H5 → 5) */
function parseRowIndex(updatedRange: string | null | undefined): number {
  const m = (updatedRange ?? "").match(/![A-Z]+(\d+)/);
  return m && m[1] ? Number(m[1]) : 0;
}

async function appendRow(
  ctx: SheetsContext,
  card: BusinessCard,
): Promise<number> {
  const res = await guard(() =>
    ctx.sheets.spreadsheets.values.append({
      spreadsheetId: ctx.spreadsheetId,
      range: a1(`A:${SHEET_LAST_COLUMN}`),
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [cardToSheetRow(card)] },
    }),
  );
  return parseRowIndex(res.data.updates?.updatedRange);
}

async function updateRow(
  ctx: SheetsContext,
  rowIndex: number,
  card: BusinessCard,
): Promise<void> {
  await guard(() =>
    ctx.sheets.spreadsheets.values.update({
      spreadsheetId: ctx.spreadsheetId,
      range: a1(`A${rowIndex}:${SHEET_LAST_COLUMN}${rowIndex}`),
      valueInputOption: "RAW",
      requestBody: { values: [cardToSheetRow(card)] },
    }),
  );
}

/**
 * 명함을 시트에 저장.
 * - 중복(이메일 또는 회사+이름) 발견 시:
 *   · onDuplicate 미지정 → status:"duplicate"(사용자 선택 필요)
 *   · "skip" → 저장 안 함, · "update" → 첫 매칭 행 갱신, · "add" → 그대로 새 행 추가
 */
export async function saveCard(
  card: BusinessCard,
  onDuplicate?: DuplicateAction,
): Promise<SaveCardResponse> {
  const ctx = getContext();
  await ensureHeader(ctx);

  const dataRows = await getDataRows(ctx);
  const matches = findDuplicateRows(dataRows, card);
  const url = spreadsheetUrl();

  if (matches.length > 0 && onDuplicate !== "add") {
    if (!onDuplicate) {
      return { ok: true, status: "duplicate", matches, spreadsheetUrl: url };
    }
    if (onDuplicate === "skip") {
      return { ok: true, status: "skipped" };
    }
    // update: 첫 번째 매칭 행 갱신
    const first = matches[0];
    if (first) {
      await updateRow(ctx, first.rowIndex, card);
      return {
        ok: true,
        status: "updated",
        rowIndex: first.rowIndex,
        spreadsheetUrl: url,
      };
    }
  }

  // 신규 추가(중복 없음 또는 onDuplicate==="add")
  const rowIndex = await appendRow(ctx, card);
  return { ok: true, status: "appended", rowIndex, spreadsheetUrl: url };
}
