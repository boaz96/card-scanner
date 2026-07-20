import { google, type sheets_v4, type drive_v3 } from "googleapis";
import {
  SHEET_HEADERS,
  SHEET_LAST_COLUMN,
  cardToSheetRow,
  findDuplicateRows,
  type BusinessCard,
  type DuplicateAction,
  type SaveCardResponse,
  type SheetMeta,
  type SheetSummary,
} from "@card-scanner/shared";
import { env } from "../env.js";
import { AppError } from "../errors.js";

/**
 * Google Sheets API v4 서비스(서비스 계정 인증).
 * - 대상 스프레드시트/탭을 요청마다 지정할 수 있고, 미지정 시 .env 기본값을 사용합니다.
 * - 헤더 자동 생성, 중복 처리, append/update, 탭 추가, 스프레드시트 생성(+공유)을 담당합니다.
 * - 인증정보는 서버 환경변수에서만 로드합니다.
 */

// spreadsheets: 읽기/쓰기, drive.file: 앱이 만든 파일(생성 시트) 관리·공유
const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.file",
];

interface AuthContext {
  sheets: sheets_v4.Sheets;
  drive: drive_v3.Drive;
}

/** 시트 인증 설정 여부(이메일+키). 대상 시트는 앱에서 지정 가능하므로 여기선 검사하지 않음 */
export function isSheetsConfigured(): boolean {
  return Boolean(env.GOOGLE_SHEETS_CLIENT_EMAIL && env.GOOGLE_SHEETS_PRIVATE_KEY);
}

export function spreadsheetUrlFor(id: string): string {
  return `https://docs.google.com/spreadsheets/d/${id}/edit`;
}

/** 인증된 sheets/drive 클라이언트 준비 */
function getAuth(): AuthContext {
  const clientEmail = env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const privateKey = env.GOOGLE_SHEETS_PRIVATE_KEY;
  if (!clientEmail || !privateKey) {
    throw new AppError(
      "SHEETS_NOT_CONFIGURED",
      500,
      "구글 시트 저장이 설정되지 않았습니다. 서비스 계정 인증정보를 확인해 주세요.",
    );
  }
  const auth = new google.auth.JWT({
    email: clientEmail,
    // .env 에 한 줄로 저장된 private_key 의 \n 이스케이프를 실제 줄바꿈으로 복원
    key: privateKey.replace(/\\n/g, "\n"),
    scopes: SCOPES,
  });
  return {
    sheets: google.sheets({ version: "v4", auth }),
    drive: google.drive({ version: "v3", auth }),
  };
}

/** 대상 스프레드시트 ID 확정(요청값 > .env 기본값) */
function resolveSpreadsheetId(override?: string): string {
  const id = override?.trim() || env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!id) {
    throw new AppError(
      "SHEETS_NO_TARGET",
      400,
      "저장할 스프레드시트가 지정되지 않았습니다. 대상 시트를 선택하거나 만들어 주세요.",
    );
  }
  return id;
}

/** 대상 탭 이름 확정(요청값 > .env 기본값) */
function resolveTab(override?: string): string {
  return override?.trim() || env.GOOGLE_SHEETS_TAB_NAME;
}

/** 탭 이름을 A1 표기에 안전하게 인용 */
function a1(tab: string, range: string): string {
  return `'${tab.replace(/'/g, "''")}'!${range}`;
}

/** google 호출을 표준 에러로 감싸기(원인별 세분화 + 로그) */
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const lower = msg.toLowerCase();
    console.error("[sheets] Google API 오류:", msg);

    if (msg.includes("403") || lower.includes("permission")) {
      throw new AppError(
        "SHEETS_PERMISSION",
        502,
        "시트에 접근 권한이 없습니다. 서비스 계정 이메일을 시트에 편집자로 공유했는지 확인해 주세요.",
      );
    }
    if (lower.includes("unable to parse range")) {
      throw new AppError(
        "SHEETS_TAB",
        502,
        "시트 탭 이름이 맞지 않습니다. 대상 탭 이름을 확인해 주세요.",
      );
    }
    if (msg.includes("404") || lower.includes("not found") || lower.includes("requested entity")) {
      throw new AppError(
        "SHEETS_NOT_FOUND",
        502,
        "스프레드시트를 찾을 수 없습니다. 시트 ID를 확인해 주세요.",
      );
    }
    if (lower.includes("invalid_grant") || lower.includes("decoder") || lower.includes("private key") || lower.includes("jwt")) {
      throw new AppError(
        "SHEETS_AUTH",
        502,
        "서비스 계정 인증에 실패했습니다. private_key 형식과 client_email 을 확인해 주세요.",
      );
    }
    throw new AppError(
      "SHEETS_FAILED",
      502,
      "구글 시트 작업 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
    );
  }
}

/** 스프레드시트 메타(제목 + 탭 목록) 조회 */
export async function getSpreadsheetMeta(
  spreadsheetIdOverride?: string,
): Promise<SheetMeta> {
  const ctx = getAuth();
  const spreadsheetId = resolveSpreadsheetId(spreadsheetIdOverride);
  const res = await guard(() =>
    ctx.sheets.spreadsheets.get({
      spreadsheetId,
      fields: "spreadsheetId,spreadsheetUrl,properties.title,sheets.properties.title",
    }),
  );
  const tabs = (res.data.sheets ?? [])
    .map((s) => s.properties?.title ?? "")
    .filter((t) => t.length > 0);
  return {
    ok: true,
    spreadsheetId,
    title: res.data.properties?.title ?? "(제목 없음)",
    spreadsheetUrl: res.data.spreadsheetUrl ?? spreadsheetUrlFor(spreadsheetId),
    tabs,
  };
}

/** 최초 1회 헤더 행 보장(대상 탭) */
async function ensureHeader(
  ctx: AuthContext,
  spreadsheetId: string,
  tab: string,
): Promise<void> {
  const res = await guard(() =>
    ctx.sheets.spreadsheets.values.get({
      spreadsheetId,
      range: a1(tab, "1:1"),
    }),
  );
  const existing = res.data.values?.[0] ?? [];
  const mismatch =
    existing.length < SHEET_HEADERS.length ||
    SHEET_HEADERS.some((h, i) => String(existing[i] ?? "") !== h);
  if (mismatch) {
    await guard(() =>
      ctx.sheets.spreadsheets.values.update({
        spreadsheetId,
        range: a1(tab, `A1:${SHEET_LAST_COLUMN}1`),
        valueInputOption: "RAW",
        requestBody: { values: [[...SHEET_HEADERS]] },
      }),
    );
  }
}

/** 데이터 행(2행부터) 조회 → 문자열 2차원 배열 */
async function getDataRows(
  ctx: AuthContext,
  spreadsheetId: string,
  tab: string,
): Promise<string[][]> {
  const res = await guard(() =>
    ctx.sheets.spreadsheets.values.get({
      spreadsheetId,
      range: a1(tab, `A2:${SHEET_LAST_COLUMN}`),
    }),
  );
  const values = res.data.values ?? [];
  return values.map((row) => row.map((cell) => String(cell ?? "")));
}

/** append 결과 updatedRange 에서 행 번호 추출 (예: 'Sheet'!A5:I5 → 5) */
function parseRowIndex(updatedRange: string | null | undefined): number {
  const m = (updatedRange ?? "").match(/![A-Z]+(\d+)/);
  return m && m[1] ? Number(m[1]) : 0;
}

async function appendRow(
  ctx: AuthContext,
  spreadsheetId: string,
  tab: string,
  card: BusinessCard,
): Promise<number> {
  const res = await guard(() =>
    ctx.sheets.spreadsheets.values.append({
      spreadsheetId,
      range: a1(tab, `A:${SHEET_LAST_COLUMN}`),
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [cardToSheetRow(card)] },
    }),
  );
  return parseRowIndex(res.data.updates?.updatedRange);
}

async function updateRow(
  ctx: AuthContext,
  spreadsheetId: string,
  tab: string,
  rowIndex: number,
  card: BusinessCard,
): Promise<void> {
  await guard(() =>
    ctx.sheets.spreadsheets.values.update({
      spreadsheetId,
      range: a1(tab, `A${rowIndex}:${SHEET_LAST_COLUMN}${rowIndex}`),
      valueInputOption: "RAW",
      requestBody: { values: [cardToSheetRow(card)] },
    }),
  );
}

/** 새 탭 추가(이미 있으면 그대로 두고), 추가 탭에 헤더 생성 → 갱신된 메타 반환 */
export async function addTab(
  title: string,
  spreadsheetIdOverride?: string,
): Promise<SheetMeta> {
  const ctx = getAuth();
  const spreadsheetId = resolveSpreadsheetId(spreadsheetIdOverride);
  const tab = title.trim();
  if (!tab) {
    throw new AppError("SHEETS_TAB", 400, "탭 이름을 입력해 주세요.");
  }

  const meta = await getSpreadsheetMeta(spreadsheetId);
  if (!meta.tabs.includes(tab)) {
    await guard(() =>
      ctx.sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: tab } } }],
        },
      }),
    );
  }
  await ensureHeader(ctx, spreadsheetId, tab);
  return getSpreadsheetMeta(spreadsheetId);
}

/** 공유 드라이브 ID(설정 시) */
function sharedDriveId(): string | undefined {
  return env.GOOGLE_SHARED_DRIVE_ID?.trim() || undefined;
}

/** 새로 만든 스프레드시트의 첫 시트를 기본 탭 이름으로 변경 */
async function renameFirstSheet(
  ctx: AuthContext,
  spreadsheetId: string,
  tab: string,
): Promise<void> {
  const meta = await guard(() =>
    ctx.sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties(sheetId,title)",
    }),
  );
  const first = meta.data.sheets?.[0]?.properties;
  if (first && first.title !== tab && typeof first.sheetId === "number") {
    await guard(() =>
      ctx.sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              updateSheetProperties: {
                properties: { sheetId: first.sheetId, title: tab },
                fields: "title",
              },
            },
          ],
        },
      }),
    );
  }
}

/**
 * 새 스프레드시트 생성(기본 탭에 헤더).
 * - 공유 드라이브가 설정돼 있으면 그 드라이브에 생성(서비스 계정도 생성 가능, 팀 전원 열람).
 * - 아니면 레거시(개인 계정)에선 서비스 계정 quota 제약으로 실패할 수 있음.
 */
export async function createSpreadsheet(
  title: string,
  shareWithEmail?: string,
  shareWithDomain?: boolean,
): Promise<SheetMeta> {
  const ctx = getAuth();
  const defaultTab = env.GOOGLE_SHEETS_TAB_NAME;
  const driveId = sharedDriveId();
  const name = title.trim() || "명함 스캔";
  let spreadsheetId: string;

  if (driveId) {
    // 공유 드라이브에 생성(Drive API) → 서비스 계정도 quota 제약 없이 생성 가능
    try {
      const file = await ctx.drive.files.create({
        requestBody: {
          name,
          mimeType: "application/vnd.google-apps.spreadsheet",
          parents: [driveId],
        },
        supportsAllDrives: true,
        fields: "id",
      });
      if (!file.data.id) throw new Error("생성된 파일 ID 없음");
      spreadsheetId = file.data.id;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[sheets] 공유 드라이브 시트 생성 실패:", msg);
      if (msg.toLowerCase().includes("permission") || msg.includes("403") || msg.includes("404")) {
        throw new AppError(
          "SHARED_DRIVE_PERMISSION",
          502,
          "공유 드라이브에 시트를 만들 수 없습니다. 서비스 계정을 해당 공유 드라이브 멤버(콘텐츠 관리자)로 추가했는지, GOOGLE_SHARED_DRIVE_ID 가 맞는지 확인해 주세요.",
        );
      }
      throw new AppError("SHEETS_FAILED", 502, "스프레드시트 생성에 실패했습니다.");
    }
    await renameFirstSheet(ctx, spreadsheetId, defaultTab);
  } else {
    // 레거시 경로(공유 드라이브 미설정)
    try {
      const created = await ctx.sheets.spreadsheets.create({
        requestBody: {
          properties: { title: name },
          sheets: [{ properties: { title: defaultTab } }],
        },
        fields: "spreadsheetId",
      });
      if (!created.data.spreadsheetId) throw new Error("no id");
      spreadsheetId = created.data.spreadsheetId;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[sheets] 시트 생성 실패:", msg);
      if (msg.toLowerCase().includes("permission") || msg.includes("403")) {
        throw new AppError(
          "SHEETS_CREATE_PERMISSION",
          502,
          "새 시트를 만들 권한이 없습니다. Workspace 공유 드라이브를 설정하고 GOOGLE_SHARED_DRIVE_ID 를 지정해 주세요(서비스 계정은 개인 드라이브에 파일을 만들 수 없습니다).",
        );
      }
      throw new AppError("SHEETS_FAILED", 502, "스프레드시트 생성에 실패했습니다.");
    }
  }

  await ensureHeader(ctx, spreadsheetId, defaultTab);

  // 공유 드라이브면 멤버 전원이 이미 열람 가능. 개별 이메일 공유는 요청 시에만(비치명적).
  if (shareWithEmail) {
    try {
      await ctx.drive.permissions.create({
        fileId: spreadsheetId,
        supportsAllDrives: true,
        sendNotificationEmail: true,
        requestBody: { role: "writer", type: "user", emailAddress: shareWithEmail },
      });
    } catch (e) {
      console.error(
        "[sheets] 생성된 시트 이메일 공유 실패(시트는 생성됨):",
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  // 회사 도메인 전체 편집자 공유(요청 + 도메인 설정 시). 실패는 비치명적.
  if (shareWithDomain) {
    const domain = env.GOOGLE_WORKSPACE_DOMAIN?.trim();
    if (!domain) {
      console.error("[sheets] 도메인 공유 요청됐으나 GOOGLE_WORKSPACE_DOMAIN 미설정 — 건너뜀");
    } else {
      try {
        await ctx.drive.permissions.create({
          fileId: spreadsheetId,
          supportsAllDrives: true,
          sendNotificationEmail: false,
          requestBody: { role: "writer", type: "domain", domain },
        });
      } catch (e) {
        console.error(
          "[sheets] 도메인 공유 실패(시트는 생성됨). 관리자 도메인 공유 정책을 확인하세요:",
          e instanceof Error ? e.message : String(e),
        );
      }
    }
  }

  return getSpreadsheetMeta(spreadsheetId);
}

/** 공유 드라이브 내 스프레드시트 목록(미설정 시 빈 목록) */
export async function listSpreadsheets(): Promise<{
  sharedDriveConfigured: boolean;
  sheets: SheetSummary[];
}> {
  const driveId = sharedDriveId();
  if (!driveId) return { sharedDriveConfigured: false, sheets: [] };

  const ctx = getAuth();
  const res = await guard(() =>
    ctx.drive.files.list({
      corpora: "drive",
      driveId,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
      orderBy: "modifiedTime desc",
      fields: "files(id,name)",
      pageSize: 100,
    }),
  );
  const sheets: SheetSummary[] = (res.data.files ?? [])
    .map((f) => ({ id: f.id ?? "", name: f.name ?? "(제목 없음)" }))
    .filter((s) => s.id.length > 0);
  return { sharedDriveConfigured: true, sheets };
}

export interface SaveTarget {
  spreadsheetId?: string;
  tabName?: string;
  onDuplicate?: DuplicateAction;
}

/**
 * 명함을 (지정 또는 기본) 시트/탭에 저장.
 * - 중복(이메일 또는 회사+이름) 발견 시:
 *   · onDuplicate 미지정 → status:"duplicate"(사용자 선택 필요)
 *   · "skip" → 저장 안 함, · "update" → 첫 매칭 행 갱신, · "add" → 그대로 새 행 추가
 */
export async function saveCard(
  card: BusinessCard,
  target: SaveTarget = {},
): Promise<SaveCardResponse> {
  const ctx = getAuth();
  const spreadsheetId = resolveSpreadsheetId(target.spreadsheetId);
  const tab = resolveTab(target.tabName);
  const url = spreadsheetUrlFor(spreadsheetId);

  await ensureHeader(ctx, spreadsheetId, tab);

  const dataRows = await getDataRows(ctx, spreadsheetId, tab);
  const matches = findDuplicateRows(dataRows, card);

  if (matches.length > 0 && target.onDuplicate !== "add") {
    if (!target.onDuplicate) {
      return { ok: true, status: "duplicate", matches, spreadsheetUrl: url };
    }
    if (target.onDuplicate === "skip") {
      return { ok: true, status: "skipped" };
    }
    const first = matches[0];
    if (first) {
      await updateRow(ctx, spreadsheetId, tab, first.rowIndex, card);
      return { ok: true, status: "updated", rowIndex: first.rowIndex, spreadsheetUrl: url };
    }
  }

  const rowIndex = await appendRow(ctx, spreadsheetId, tab, card);
  return { ok: true, status: "appended", rowIndex, spreadsheetUrl: url };
}
