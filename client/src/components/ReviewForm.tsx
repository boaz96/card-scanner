import { useCallback, useMemo, useState } from "react";
import type {
  BusinessCard,
  CardFieldKey,
  ExtractionResult,
} from "@card-scanner/shared";
import { SaveCardPanel } from "./SaveCardPanel.js";
import { SaveTargetPanel } from "./SaveTargetPanel.js";
import type { SaveTarget } from "../lib/api.js";

/**
 * 검수/수정 화면.
 * - 추출된 각 필드를 편집 가능한 폼으로 표시합니다.
 * - confidence 가 낮은 필드는 노란색으로 강조하고 "확인 필요" 배지를 붙입니다.
 * - 접근성: 모든 입력에 <label htmlFor>, 강조 필드는 aria-describedby 로 안내를 연결합니다.
 */

interface Props {
  result: ExtractionResult;
  onReset: () => void;
}

interface FieldDef {
  key: CardFieldKey;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: "text" | "email" | "tel" | "url";
  autoComplete?: string;
}

export function ReviewForm({ result, onReset }: Props) {
  const [card, setCard] = useState<BusinessCard>(result.card);
  const [target, setTarget] = useState<SaveTarget>({});
  // SaveTargetPanel 에 넘길 안정적 콜백(effect 루프 방지)
  const handleTargetChange = useCallback((t: SaveTarget) => setTarget(t), []);
  const lowSet = useMemo(
    () => new Set(result.lowConfidenceFields),
    [result.lowConfidenceFields],
  );

  const fields: FieldDef[] = [
    { key: "name", label: "이름(한글)", value: card.name ?? "", onChange: (v) => setCard({ ...card, name: v }), autoComplete: "name" },
    { key: "nameEn", label: "이름(영어)", value: card.nameEn ?? "", onChange: (v) => setCard({ ...card, nameEn: v }) },
    { key: "company", label: "회사", value: card.company ?? "", onChange: (v) => setCard({ ...card, company: v }), autoComplete: "organization" },
    { key: "department", label: "부서", value: card.department ?? "", onChange: (v) => setCard({ ...card, department: v }) },
    { key: "position", label: "직급/직위", value: card.position ?? "", onChange: (v) => setCard({ ...card, position: v }), autoComplete: "organization-title" },
    { key: "role", label: "직책", value: card.role ?? "", onChange: (v) => setCard({ ...card, role: v }) },
    { key: "contact.mobile", label: "휴대폰", value: card.contact.mobile ?? "", onChange: (v) => setCard({ ...card, contact: { ...card.contact, mobile: v } }), type: "tel", autoComplete: "tel" },
    { key: "contact.office", label: "사무실 전화", value: card.contact.office ?? "", onChange: (v) => setCard({ ...card, contact: { ...card.contact, office: v } }), type: "tel" },
    { key: "contact.fax", label: "팩스", value: card.contact.fax ?? "", onChange: (v) => setCard({ ...card, contact: { ...card.contact, fax: v } }), type: "tel" },
    { key: "email", label: "이메일", value: card.email ?? "", onChange: (v) => setCard({ ...card, email: v }), type: "email", autoComplete: "email" },
    { key: "website", label: "웹사이트", value: card.website ?? "", onChange: (v) => setCard({ ...card, website: v }), type: "url", autoComplete: "url" },
    { key: "address", label: "주소", value: card.address ?? "", onChange: (v) => setCard({ ...card, address: v }) },
    { key: "memo", label: "메모", value: card.memo ?? "", onChange: (v) => setCard({ ...card, memo: v }) },
  ];

  const isValid = Boolean(card.name || card.nameEn || card.company);

  return (
    <section className="review" aria-label="명함 정보 검수">
      <div className="review-head">
        <h2>정보 확인·수정</h2>
        <p className="meta">
          신뢰도 {Math.round(result.confidence * 100)}% · 출처 {result.source}
          {lowSet.size > 0 && ` · 확인 필요 ${lowSet.size}개(노란색)`}
        </p>
      </div>

      {result.warnings.length > 0 && (
        <ul className="warnings">
          {result.warnings.map((w) => (
            <li key={w} className="warning">⚠️ {w}</li>
          ))}
        </ul>
      )}

      <form className="review-grid" onSubmit={(e) => e.preventDefault()}>
        {fields.map((f) => {
          const id = `field-${f.key.replace(".", "-")}`;
          const low = lowSet.has(f.key);
          const noteId = low ? `${id}-note` : undefined;
          return (
            <div className={low ? "field field-low" : "field"} key={f.key}>
              <label htmlFor={id}>
                {f.label}
                {low && <span className="badge">확인 필요</span>}
              </label>
              <input
                id={id}
                type={f.type ?? "text"}
                value={f.value}
                onChange={(e) => f.onChange(e.target.value)}
                autoComplete={f.autoComplete}
                aria-describedby={noteId}
                aria-invalid={low || undefined}
                inputMode={f.type === "tel" ? "tel" : undefined}
              />
              {low && (
                <span id={noteId} className="field-note">
                  인식 신뢰도가 낮아요. 값을 확인해 주세요.
                </span>
              )}
            </div>
          );
        })}
      </form>

      <SaveTargetPanel onChange={handleTargetChange} />

      <SaveCardPanel
        card={card}
        target={target}
        disabledReason={isValid ? undefined : "이름 또는 회사명을 입력해야 저장할 수 있어요."}
      />

      <div className="actions">
        <button type="button" className="btn btn-ghost" onClick={onReset}>
          새 명함 촬영
        </button>
      </div>
    </section>
  );
}
