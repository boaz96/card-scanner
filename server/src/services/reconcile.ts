import {
  RAW_TO_FIELD_KEY,
  type CardFieldKey,
  type ExtractionSource,
  type LlmRawCard,
} from "@card-scanner/shared";
import type { OcrResult } from "./clovaOcr.js";

/**
 * LLM 결과와 OCR 텍스트를 대조·보정하고 confidence 를 산정하는 순수 함수.
 * - 부작용/네트워크 없음 → 단위테스트 용이.
 * - 보정 원칙: LLM 결과를 기본으로 두되, 비어있는 연락처/이메일은 OCR 로 채우고,
 *   LLM 과 OCR 이 일치하면 신뢰도를 올리고 상충하면 경고 + 신뢰도 하향.
 */

export interface CardDraft {
  name: string;
  nameEn: string;
  company: string;
  department: string;
  position: string;
  role: string;
  contact: { mobile: string; office: string; fax: string };
  email: string;
  website: string;
  address: string;
  memo: string;
}

export interface ReconcileOutput {
  draft: CardDraft;
  confidence: number;
  source: ExtractionSource;
  warnings: string[];
  /** 사용자 확인이 필요한(저신뢰) 필드 키 */
  lowConfidenceFields: CardFieldKey[];
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /(0\d{1,2})[-.\s]?(\d{3,4})[-.\s]?(\d{4})/g;

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const digitsOf = (s: string): string => s.replace(/\D/g, "");
const str = (v: string | null | undefined): string => (v ?? "").trim();

/** 숫자 전화번호를 한국식 하이픈 형식으로 */
function formatKrPhone(digits: string): string {
  if (/^01\d{9}$/.test(digits)) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  if (/^02\d{7,8}$/.test(digits)) {
    const rest = digits.slice(2);
    const mid = rest.length === 8 ? 4 : 3;
    return `02-${rest.slice(0, mid)}-${rest.slice(mid)}`;
  }
  if (/^0\d{9,10}$/.test(digits)) {
    return `${digits.slice(0, 3)}-${digits.slice(3, digits.length - 4)}-${digits.slice(-4)}`;
  }
  return digits;
}

function fromLlm(llm: LlmRawCard): CardDraft {
  return {
    name: str(llm.name),
    nameEn: str(llm.name_en),
    company: str(llm.company),
    department: str(llm.department),
    position: str(llm.position),
    role: str(llm.role),
    contact: {
      mobile: str(llm.mobile),
      office: str(llm.office_phone),
      fax: str(llm.fax),
    },
    email: str(llm.email),
    website: str(llm.website),
    address: str(llm.address),
    memo: str(llm.memo),
  };
}

export function reconcile(
  llm: LlmRawCard,
  ocr: OcrResult | null,
): ReconcileOutput {
  const draft = fromLlm(llm);
  const warnings: string[] = [];
  const lowConf = new Set<CardFieldKey>();
  let confidence = clamp01(llm.confidence ?? 0.6);

  // 모델이 스스로 확신이 낮다고 보고한 필드를 우선 반영(raw 키 → 폼 키)
  for (const rawKey of llm.low_confidence ?? []) {
    const mapped = RAW_TO_FIELD_KEY[rawKey];
    if (mapped) lowConf.add(mapped);
  }

  if (!ocr || ocr.text.trim().length === 0) {
    if (ocr === null) {
      warnings.push("OCR 대조를 건너뛰었습니다. 인식된 값을 확인해 주세요.");
    }
    confidence = clamp01(confidence - 0.05);
    return finalize(draft, confidence, "llm", warnings, lowConf);
  }

  const text = ocr.text;

  // --- 이메일 대조/보정 ---
  const ocrEmails = text.match(EMAIL_RE) ?? [];
  if (draft.email) {
    const match = ocrEmails.some(
      (e) => e.toLowerCase() === draft.email.toLowerCase(),
    );
    if (match) confidence += 0.08;
    else if (ocrEmails.length > 0) {
      warnings.push("이메일이 OCR 인식과 달라요. 값을 확인해 주세요.");
      confidence -= 0.05;
      lowConf.add("email");
    }
  } else if (ocrEmails.length > 0) {
    const first = ocrEmails[0];
    if (first) {
      draft.email = first;
      warnings.push("이메일은 OCR 로 보정했습니다. 확인해 주세요.");
      lowConf.add("email");
    }
  }

  // --- 전화 대조/보정 ---
  const ocrPhones = (text.match(PHONE_RE) ?? []).map(digitsOf);
  const corroborate = (value: string): void => {
    if (!value) return;
    if (ocrPhones.includes(digitsOf(value))) confidence += 0.05;
  };
  corroborate(draft.contact.mobile);
  corroborate(draft.contact.office);
  corroborate(draft.contact.fax);

  if (!draft.contact.mobile) {
    const mobile = ocrPhones.find((p) => p.startsWith("010"));
    if (mobile) {
      draft.contact.mobile = formatKrPhone(mobile);
      warnings.push("휴대전화는 OCR 로 보정했습니다. 확인해 주세요.");
      lowConf.add("contact.mobile");
    }
  }
  if (!draft.contact.office) {
    const office = ocrPhones.find((p) => !p.startsWith("01"));
    if (office) {
      draft.contact.office = formatKrPhone(office);
      warnings.push("전화번호는 OCR 로 보정했습니다. 확인해 주세요.");
      lowConf.add("contact.office");
    }
  }

  // --- 회사명 상호검증(있을 때만 신뢰도 가산) ---
  if (draft.company && text.replace(/\s/g, "").includes(draft.company.replace(/\s/g, ""))) {
    confidence += 0.05;
  }

  return finalize(draft, clamp01(confidence), "merged", warnings, lowConf);
}

/** 신뢰도가 낮을 때 확인이 필요한 핵심 빈 필드 */
const CORE_FIELDS: ReadonlyArray<CardFieldKey> = [
  "name",
  "company",
  "email",
  "contact.mobile",
];

function finalize(
  draft: CardDraft,
  confidence: number,
  source: ExtractionSource,
  warnings: string[],
  lowConf: Set<CardFieldKey>,
): ReconcileOutput {
  const valueOf = (key: CardFieldKey): string => {
    switch (key) {
      case "name":
        return draft.name;
      case "company":
        return draft.company;
      case "email":
        return draft.email;
      case "contact.mobile":
        return draft.contact.mobile;
      default:
        return "";
    }
  };

  if (confidence < 0.6) {
    warnings.push("인식 신뢰도가 낮습니다. 저장 전에 값을 꼭 확인해 주세요.");
    // 신뢰도가 낮으면 핵심 필드 중 비어있는 것을 확인 대상으로 강조
    for (const key of CORE_FIELDS) {
      if (!valueOf(key)) lowConf.add(key);
    }
  }

  return {
    draft,
    confidence,
    source,
    warnings,
    lowConfidenceFields: [...lowConf],
  };
}
