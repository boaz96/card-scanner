import { Router, type Request, type Response } from "express";
import { saveCardRequestSchema, type ApiError } from "@card-scanner/shared";
import { saveCard } from "../services/sheets.js";
import { toAppError } from "../errors.js";

/**
 * POST /api/save — 확인·보정된 표준 JSON 을 받아 Google Sheets 에 저장.
 * body: { card, source?, onDuplicate? }  (application/json)
 */
export const saveRouter = Router();

saveRouter.post("/", async (req: Request, res: Response) => {
  // 입력 검증
  const parsed = saveCardRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    const body: ApiError = {
      ok: false,
      code: "INVALID_BODY",
      message: "저장 요청 형식이 올바르지 않습니다.",
    };
    return res.status(400).json(body);
  }

  try {
    const result = await saveCard(parsed.data.card, parsed.data.onDuplicate);
    return res.json(result);
  } catch (e) {
    const appError = toAppError(e);
    console.error(`[save] ${appError.code}:`, e);
    return res.status(appError.httpStatus).json(appError.toApiError());
  }
});
