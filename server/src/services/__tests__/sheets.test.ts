import { describe, it, expect } from "vitest";
import {
  findDuplicateRows,
  cardToSheetRow,
  SHEET_HEADERS,
  type BusinessCard,
} from "@card-scanner/shared";

/**
 * 시트 중복 탐지 순수 함수 + 직렬화 컬럼 순서 테스트.
 * (google 네트워크 호출 없이 로직만 검증)
 */

const card: BusinessCard = {
  name: "홍길동",
  nameEn: "Gildong Hong",
  company: "가인지컨설팅그룹",
  position: "책임",
  role: "컨설턴트",
  address: "서울특별시 강남구 테헤란로 000",
  contact: { mobile: "010-1234-5678", office: "", fax: "" },
  email: "gildong.hong@example.com",
  website: "",
  memo: "",
};

// 시트 컬럼 순서(9): 이름,원본표기,회사,직급,직책,주소,휴대폰,이메일,스캔시각
const EMAIL_COL = 7;
const rowSame = [
  "홍길동", "Gildong Hong", "가인지컨설팅그룹", "책임", "컨설턴트", "주소",
  "010-0000-0000", "gildong.hong@example.com", "2026-01-01",
];
const rowOther = [
  "김철수", "Chulsoo Kim", "다른회사", "대리", "", "부산",
  "010-9999-9999", "chulsoo@other.com", "2026-01-02",
];

describe("findDuplicateRows", () => {
  it("이메일이 같으면 중복으로 잡는다", () => {
    const m = findDuplicateRows([rowOther, rowSame], card);
    expect(m).toHaveLength(1);
    expect(m[0]?.rowIndex).toBe(3); // 기본 firstRowNumber=2 → 두 번째 데이터행=3
    expect(m[0]?.email).toBe("gildong.hong@example.com");
  });

  it("이메일이 없고 회사+이름이 같으면 중복으로 잡는다", () => {
    const noEmail: BusinessCard = { ...card, email: "" };
    const rowNoEmail = [...rowSame];
    rowNoEmail[EMAIL_COL] = ""; // 이메일 비움
    const m = findDuplicateRows([rowNoEmail], noEmail);
    expect(m).toHaveLength(1);
  });

  it("회사만 같고 이름이 다르면 중복이 아니다", () => {
    const rowDiffName = [...rowSame];
    rowDiffName[0] = "다른사람";
    rowDiffName[EMAIL_COL] = ""; // 이메일도 비워 이메일 매칭 배제
    const noEmail: BusinessCard = { ...card, email: "" };
    const m = findDuplicateRows([rowDiffName], noEmail);
    expect(m).toHaveLength(0);
  });

  it("중복 없으면 빈 배열", () => {
    expect(findDuplicateRows([rowOther], card)).toHaveLength(0);
  });
});

describe("cardToSheetRow", () => {
  it("헤더와 같은 길이/순서로 직렬화된다", () => {
    const at = new Date("2026-07-06T00:00:00.000Z");
    const row = cardToSheetRow(card, at);
    expect(row).toHaveLength(SHEET_HEADERS.length);
    expect(row[0]).toBe("홍길동");
    expect(row[3]).toBe("책임"); // 직급
    expect(row[4]).toBe("컨설턴트"); // 직책
    expect(row[7]).toBe("gildong.hong@example.com");
    expect(row[8]).toBe("2026-07-06T00:00:00.000Z");
  });
});
