import { Router, type Request, type Response } from "express";
import {
  addTabRequestSchema,
  createSheetRequestSchema,
  parseSpreadsheetId,
  type ApiError,
} from "@card-scanner/shared";
import {
  addTab,
  createSpreadsheet,
  getSpreadsheetMeta,
  listSpreadsheets,
} from "../services/sheets.js";
import { toAppError } from "../errors.js";

/**
 * 시트 대상 관리 라우터.
 * - GET  /api/sheets/meta?spreadsheetId=  → 제목 + 탭 목록
 * - POST /api/sheets/tabs { spreadsheetId?, title } → 탭 추가
 * - POST /api/sheets      { title, shareWithEmail? } → 새 스프레드시트 생성(+공유)
 */
export const sheetsRouter = Router();

function fail(res: Response, status: number, code: string, message: string) {
  const body: ApiError = { ok: false, code, message };
  return res.status(status).json(body);
}

function handle(res: Response, e: unknown, tag: string) {
  const appError = toAppError(e);
  console.error(`[sheets:${tag}] ${appError.code}:`, e);
  return res.status(appError.httpStatus).json(appError.toApiError());
}

/** 공유 드라이브 내 스프레드시트 목록(팀 시트 선택용) */
sheetsRouter.get("/list", async (_req: Request, res: Response) => {
  try {
    const { sharedDriveConfigured, sheets } = await listSpreadsheets();
    return res.json({ ok: true, sharedDriveConfigured, sheets });
  } catch (e) {
    return handle(res, e, "list");
  }
});

/** 스프레드시트 메타(제목 + 탭 목록) */
sheetsRouter.get("/meta", async (req: Request, res: Response) => {
  const raw = typeof req.query.spreadsheetId === "string" ? req.query.spreadsheetId : "";
  // URL 을 통째로 넘겨도 ID 로 정규화
  const spreadsheetId = raw ? (parseSpreadsheetId(raw) ?? raw) : undefined;
  try {
    return res.json(await getSpreadsheetMeta(spreadsheetId));
  } catch (e) {
    return handle(res, e, "meta");
  }
});

/** 탭 추가 */
sheetsRouter.post("/tabs", async (req: Request, res: Response) => {
  const parsed = addTabRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return fail(res, 400, "INVALID_BODY", "탭 추가 요청 형식이 올바르지 않습니다.");
  }
  const { spreadsheetId, title } = parsed.data;
  try {
    return res.json(await addTab(title, spreadsheetId));
  } catch (e) {
    return handle(res, e, "tabs");
  }
});

/** 새 스프레드시트 생성 */
sheetsRouter.post("/", async (req: Request, res: Response) => {
  const parsed = createSheetRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return fail(res, 400, "INVALID_BODY", "시트 생성 요청 형식이 올바르지 않습니다.");
  }
  const { title, shareWithEmail, shareWithDomain } = parsed.data;
  try {
    return res.json(await createSpreadsheet(title, shareWithEmail, shareWithDomain));
  } catch (e) {
    return handle(res, e, "create");
  }
});
