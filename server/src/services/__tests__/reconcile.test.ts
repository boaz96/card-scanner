import { describe, it, expect } from "vitest";
import type { LlmRawCard } from "@card-scanner/shared";
import { reconcile } from "../reconcile.js";

/**
 * reconcile 순수 함수 단위테스트.
 * 네트워크 없이 LLM↔OCR 대조 로직만 검증합니다.
 */

const baseLlm: LlmRawCard = {
  name: "홍길동",
  name_en: "Gildong Hong",
  company: "가인지컨설팅그룹",
  department: "컨설팅본부",
  title: "책임 컨설턴트",
  mobile: "010-1234-5678",
  office_phone: "",
  fax: "",
  email: "",
  website: "https://example.com",
  address: "서울특별시 강남구 테헤란로 000",
  memo: "",
  confidence: 0.7,
};

describe("reconcile", () => {
  it("OCR 이 없으면 source=llm 이고 신뢰도를 약간 낮춘다", () => {
    const out = reconcile(baseLlm, null);
    expect(out.source).toBe("llm");
    expect(out.confidence).toBeLessThan(0.7);
    expect(out.warnings.some((w) => w.includes("OCR"))).toBe(true);
  });

  it("빈 이메일을 OCR 텍스트로 보정한다", () => {
    const out = reconcile(baseLlm, {
      text: "가인지컨설팅그룹 gildong.hong@example.com 010-1234-5678",
      fields: [],
    });
    expect(out.draft.email).toBe("gildong.hong@example.com");
    expect(out.source).toBe("merged");
    expect(out.warnings.some((w) => w.includes("이메일"))).toBe(true);
  });

  it("전화/회사명이 OCR 과 일치하면 신뢰도가 올라간다", () => {
    const out = reconcile(baseLlm, {
      text: "가인지컨설팅그룹 010-1234-5678",
      fields: [],
    });
    expect(out.confidence).toBeGreaterThan(0.7);
  });

  it("빈 사무실 전화를 OCR 의 유선번호로 보정한다", () => {
    const out = reconcile(baseLlm, {
      text: "대표전화 02-555-1234",
      fields: [],
    });
    expect(out.draft.contact.office).toBe("02-555-1234");
  });

  it("이메일이 OCR 과 상충하면 경고하고 신뢰도를 낮춘다", () => {
    const llm: LlmRawCard = { ...baseLlm, email: "wrong@typo.com", confidence: 0.7 };
    const out = reconcile(llm, {
      text: "correct@example.com",
      fields: [],
    });
    expect(out.warnings.some((w) => w.includes("이메일"))).toBe(true);
    expect(out.confidence).toBeLessThan(0.7);
  });
});
