import { Router, type Request, type Response } from "express";
import multer, { MulterError } from "multer";
import type { ApiError } from "@card-scanner/shared";
import { extractCard } from "../services/extractCard.js";
import { AppError, toAppError } from "../errors.js";

/**
 * POST /api/scan — 명함 이미지 업로드 → 추출 결과(ExtractionResult) 반환.
 * 파이프라인: sharp 전처리 → Claude Vision → CLOVA 대조 → Zod 검증.
 */

export const scanRouter = Router();

// 메모리 저장(원본 미저장), 8MB 제한, 이미지 MIME 만 허용
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("이미지 파일만 업로드할 수 있습니다."));
  },
});

scanRouter.post("/", (req: Request, res: Response) => {
  upload.single("image")(req, res, async (err: unknown) => {
    // 1) 업로드 단계 오류
    if (err instanceof MulterError) {
      const message =
        err.code === "LIMIT_FILE_SIZE"
          ? "이미지 용량이 너무 큽니다(최대 8MB)."
          : "이미지 업로드에 실패했습니다.";
      const body: ApiError = { ok: false, code: err.code, message };
      return res.status(400).json(body);
    }
    if (err instanceof Error) {
      const body: ApiError = {
        ok: false,
        code: "UPLOAD_ERROR",
        message: err.message,
      };
      return res.status(400).json(body);
    }
    if (!req.file) {
      const body: ApiError = {
        ok: false,
        code: "NO_IMAGE",
        message: "이미지가 첨부되지 않았습니다.",
      };
      return res.status(400).json(body);
    }

    // 2) 추출 파이프라인
    try {
      const result = await extractCard(req.file.buffer);
      return res.json(result);
    } catch (e) {
      const appError: AppError = toAppError(e);
      // 서버 로그(운영 모니터링용). 사용자에겐 안전한 메시지만 전달.
      console.error(`[scan] ${appError.code}:`, e);
      return res.status(appError.httpStatus).json(appError.toApiError());
    }
  });
});
