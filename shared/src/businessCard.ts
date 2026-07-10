import { z } from "zod";

/**
 * 명함 데이터 공통 계약(contract).
 * - 서버의 추출/검증, 프론트 확인 폼, Google Sheets 컬럼이 모두 이 스키마를 기준으로 동작합니다.
 * - 여기서 한 번 정의한 필드 순서가 곧 스프레드시트 컬럼 순서가 됩니다(SHEET_COLUMNS).
 */

/** 빈 문자열을 undefined 로 정규화하는 선택적 문자열 (LLM 이 "" 를 반환하는 경우가 많음) */
const optionalText = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? undefined : v))
  .optional();

/** 이메일: 형식이 맞지 않아도 저장은 허용하되 경고로 잡기 위해 느슨하게 문자열로 받음 */
const optionalEmail = optionalText;

/** 전화/팩스 등 연락처 묶음 */
export const contactSchema = z.object({
  /** 휴대전화 */
  mobile: optionalText,
  /** 대표/사무실 전화 */
  office: optionalText,
  /** 팩스 */
  fax: optionalText,
});
export type Contact = z.infer<typeof contactSchema>;

/**
 * 확정된 명함 핵심 데이터.
 * 최소 요구조건: 이름 또는 회사명 중 하나는 반드시 있어야 유효한 명함으로 간주.
 */
export const businessCardSchema = z
  .object({
    /** 한글 이름 */
    name: optionalText,
    /** 영문 이름(로마자) */
    nameEn: optionalText,
    /** 회사명 (로고 안의 회사명 포함) */
    company: optionalText,
    /** 부서 */
    department: optionalText,
    /** 직급/직위 (사원·대리·과장·차장·부장·이사·상무 등 서열) */
    position: optionalText,
    /** 직책 (팀장·실장·본부장·센터장·PM·CTO 등 담당 역할) */
    role: optionalText,
    /** 연락처 묶음 */
    contact: contactSchema.default({}),
    /** 이메일 */
    email: optionalEmail,
    /** 웹사이트 */
    website: optionalText,
    /** 주소 */
    address: optionalText,
    /** 기타 메모 */
    memo: optionalText,
  })
  .refine((c) => Boolean(c.name || c.nameEn || c.company), {
    message: "이름 또는 회사명 중 최소 하나는 필요합니다.",
    path: ["name"],
  });

export type BusinessCard = z.infer<typeof businessCardSchema>;

/** 추출 정보의 출처 */
export const extractionSourceSchema = z.enum([
  "llm", // Claude Vision 단독
  "ocr", // CLOVA OCR 단독
  "merged", // LLM + OCR 대조·보정 결과
]);
export type ExtractionSource = z.infer<typeof extractionSourceSchema>;

/**
 * 서버가 프론트로 돌려주는 추출 결과.
 * card(확정 후보) + 신뢰도/출처/원문/경고를 함께 전달해 사용자 보정 UI 를 돕습니다.
 */
export const extractionResultSchema = z.object({
  card: businessCardSchema,
  /** 0~1 전체 신뢰도 (낮으면 프론트에서 재촬영 유도) */
  confidence: z.number().min(0).max(1),
  source: extractionSourceSchema,
  /** OCR/LLM 이 읽은 원문 텍스트 (사용자가 직접 대조 가능) */
  rawText: z.string().optional(),
  /** 저조도·흐릿함·필드 불일치 등 사용자 안내용 경고 메시지 */
  warnings: z.array(z.string()).default([]),
  /**
   * 신뢰도가 낮아 사용자 확인이 필요한 필드 키 목록.
   * 값은 BusinessCard 폼 필드 키(name, company, contact.mobile 등)입니다.
   * 프론트 검수 폼이 이 필드를 노란색으로 강조합니다.
   */
  lowConfidenceFields: z.array(z.string()).default([]),
});
export type ExtractionResult = z.infer<typeof extractionResultSchema>;

/** 검수 폼/저신뢰 표시에 쓰는 필드 키(중앙 정의) */
export const CARD_FIELD_KEYS = [
  "name",
  "nameEn",
  "company",
  "department",
  "position",
  "role",
  "contact.mobile",
  "contact.office",
  "contact.fax",
  "email",
  "website",
  "address",
  "memo",
] as const;
export type CardFieldKey = (typeof CARD_FIELD_KEYS)[number];

/** LLM raw 키 → 폼 필드 키 매핑(저신뢰 필드 병합에 사용) */
export const RAW_TO_FIELD_KEY: Readonly<Record<string, CardFieldKey>> = {
  name: "name",
  name_en: "nameEn",
  company: "company",
  department: "department",
  position: "position",
  role: "role",
  mobile: "contact.mobile",
  office_phone: "contact.office",
  fax: "contact.fax",
  email: "email",
  website: "website",
  address: "address",
  memo: "memo",
};

/**
 * LLM 이 반환하도록 요구하는 "날것의" JSON 스키마.
 * businessCardSchema 보다 느슨하게(모두 nullable) 받아 파싱 실패를 줄이고,
 * 서버에서 businessCardSchema 로 정규화·검증합니다.
 */
export const llmRawCardSchema = z.object({
  name: z.string().nullable().optional(),
  name_en: z.string().nullable().optional(),
  company: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
  position: z.string().nullable().optional(),
  role: z.string().nullable().optional(),
  mobile: z.string().nullable().optional(),
  office_phone: z.string().nullable().optional(),
  fax: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  memo: z.string().nullable().optional(),
  /** LLM 자기평가 전체 신뢰도 0~1 */
  confidence: z.number().min(0).max(1).nullable().optional(),
  /**
   * 모델이 스스로 확신이 낮다고 판단한 필드의 raw 키 목록
   * (예: ["position", "role", "email"]). 검수 폼 강조에 활용.
   */
  low_confidence: z.array(z.string()).nullable().optional(),
});
export type LlmRawCard = z.infer<typeof llmRawCardSchema>;

/** 중복 발견 시 사용자가 선택하는 처리 방식 */
export const duplicateActionSchema = z.enum(["add", "skip", "update"]);
export type DuplicateAction = z.infer<typeof duplicateActionSchema>;

/** 프론트가 사용자 확인/보정 후 저장 요청 시 보내는 바디 */
export const saveCardRequestSchema = z.object({
  card: businessCardSchema,
  /** 감사/추적용: 어떤 방식으로 뽑혔는지 */
  source: extractionSourceSchema.optional(),
  /**
   * 중복 발견 시 처리 방식.
   * 미지정으로 저장을 시도했다가 중복이 발견되면 서버가 status:"duplicate" 로 되묻고,
   * 프론트가 사용자 선택(add/skip/update)을 담아 재요청합니다.
   */
  onDuplicate: duplicateActionSchema.optional(),
  /** 저장 대상 스프레드시트 ID(생략 시 .env 기본값) */
  spreadsheetId: z.string().optional(),
  /** 저장 대상 탭 이름(생략 시 .env 기본값) */
  tabName: z.string().optional(),
});
export type SaveCardRequest = z.infer<typeof saveCardRequestSchema>;

/** 중복으로 매칭된 기존 시트 행 정보 */
export const duplicateMatchSchema = z.object({
  /** 시트 실제 행 번호(1-기반, 헤더=1) */
  rowIndex: z.number().int().positive(),
  name: z.string(),
  company: z.string(),
  email: z.string(),
});
export type DuplicateMatch = z.infer<typeof duplicateMatchSchema>;

/**
 * 저장 응답(성공 계열, status 로 구분되는 판별 유니온).
 * - appended/updated: 실제 반영, rowIndex 포함
 * - skipped: 중복이라 사용자가 건너뛰기 선택
 * - duplicate: 중복 발견 → 사용자 선택 필요(matches 반환)
 */
export const saveCardResponseSchema = z.discriminatedUnion("status", [
  z.object({
    ok: z.literal(true),
    status: z.literal("appended"),
    rowIndex: z.number().int().positive(),
    spreadsheetUrl: z.string().url(),
  }),
  z.object({
    ok: z.literal(true),
    status: z.literal("updated"),
    rowIndex: z.number().int().positive(),
    spreadsheetUrl: z.string().url(),
  }),
  z.object({
    ok: z.literal(true),
    status: z.literal("skipped"),
  }),
  z.object({
    ok: z.literal(true),
    status: z.literal("duplicate"),
    matches: z.array(duplicateMatchSchema).min(1),
    spreadsheetUrl: z.string().url(),
  }),
]);
export type SaveCardResponse = z.infer<typeof saveCardResponseSchema>;

/** 서버 공통 에러 응답 */
export const apiErrorSchema = z.object({
  ok: z.literal(false),
  /** 프로그램용 에러 코드 */
  code: z.string(),
  /** 사용자에게 그대로 보여줄 수 있는 한국어 메시지 */
  message: z.string(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/**
 * Google Sheets 컬럼 정의 (헤더 + 값 추출 순서).
 * 시트 헤더가 없을 때 서버가 이 헤더를 자동 생성합니다.
 * 순서를 바꾸면 COL 인덱스와 append/update 범위도 함께 바뀝니다.
 */
export const SHEET_COLUMNS: ReadonlyArray<{
  header: string;
  get: (c: BusinessCard, scannedAt: Date) => string;
}> = [
  { header: "이름(한글)", get: (c) => c.name ?? "" },
  { header: "이름(영어)", get: (c) => c.nameEn ?? "" },
  { header: "회사", get: (c) => c.company ?? "" },
  { header: "직급", get: (c) => c.position ?? "" },
  { header: "직책", get: (c) => c.role ?? "" },
  { header: "주소", get: (c) => c.address ?? "" },
  { header: "휴대폰", get: (c) => c.contact?.mobile ?? "" },
  { header: "이메일", get: (c) => c.email ?? "" },
  { header: "스캔시각", get: (_c, scannedAt) => scannedAt.toISOString() },
];

/** 컬럼 인덱스(0-기반). 중복 탐지·업데이트 시 사용. */
export const COL = {
  NAME: 0,
  NAME_EN: 1,
  COMPANY: 2,
  POSITION: 3,
  ROLE: 4,
  ADDRESS: 5,
  MOBILE: 6,
  EMAIL: 7,
  SCANNED_AT: 8,
} as const;

/** 마지막 컬럼의 A1 표기 문자(9컬럼 → "I") */
export const SHEET_LAST_COLUMN = "I";

/** 시트 헤더 행 (문자열 배열) */
export const SHEET_HEADERS: ReadonlyArray<string> = SHEET_COLUMNS.map(
  (col) => col.header,
);

/** 명함 1건을 시트 한 행(문자열 배열)으로 직렬화 */
export function cardToSheetRow(
  card: BusinessCard,
  scannedAt: Date = new Date(),
): string[] {
  return SHEET_COLUMNS.map((col) => col.get(card, scannedAt));
}

/** 시트 데이터 행들에서 이메일 또는 (회사+이름) 일치 중복을 찾음(순수 함수, 테스트용) */
export function findDuplicateRows(
  dataRows: ReadonlyArray<ReadonlyArray<string>>,
  card: BusinessCard,
  /** dataRows[0] 이 시트에서 몇 번째 행인지(기본 2: 헤더 다음) */
  firstRowNumber = 2,
): DuplicateMatch[] {
  const norm = (v: string | undefined): string =>
    (v ?? "").trim().toLowerCase();
  const email = norm(card.email);
  const company = norm(card.company);
  const name = norm(card.name);

  const matches: DuplicateMatch[] = [];
  dataRows.forEach((row, i) => {
    const rowEmail = norm(row[COL.EMAIL]);
    const rowCompany = norm(row[COL.COMPANY]);
    const rowName = norm(row[COL.NAME]);

    const emailHit = email.length > 0 && rowEmail === email;
    const nameCompanyHit =
      company.length > 0 && name.length > 0 && rowCompany === company && rowName === name;

    if (emailHit || nameCompanyHit) {
      matches.push({
        rowIndex: firstRowNumber + i,
        name: row[COL.NAME] ?? "",
        company: row[COL.COMPANY] ?? "",
        email: row[COL.EMAIL] ?? "",
      });
    }
  });
  return matches;
}
