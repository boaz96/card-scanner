import { useState } from "react";
import type {
  BusinessCard,
  DuplicateAction,
  DuplicateMatch,
} from "@card-scanner/shared";
import { saveCard } from "../lib/api.js";

/**
 * 인식 결과를 Google Sheets 에 저장하는 패널.
 * - 중복(이메일 또는 회사+이름) 발견 시 사용자에게 추가/건너뛰기/업데이트를 선택받아 재요청합니다.
 */

interface Props {
  card: BusinessCard;
  /** 저장 불가 사유(있으면 버튼 비활성화 + 안내) */
  disabledReason?: string;
}

type State =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "duplicate"; matches: DuplicateMatch[]; url: string }
  | { kind: "done"; message: string; url?: string }
  | { kind: "error"; message: string };

export function SaveCardPanel({ card, disabledReason }: Props) {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function run(onDuplicate?: DuplicateAction) {
    setState({ kind: "saving" });
    try {
      const res = await saveCard(card, onDuplicate);
      switch (res.status) {
        case "duplicate":
          setState({ kind: "duplicate", matches: res.matches, url: res.spreadsheetUrl });
          break;
        case "appended":
          setState({ kind: "done", message: `시트 ${res.rowIndex}행에 추가했습니다.`, url: res.spreadsheetUrl });
          break;
        case "updated":
          setState({ kind: "done", message: `기존 ${res.rowIndex}행을 업데이트했습니다.`, url: res.spreadsheetUrl });
          break;
        case "skipped":
          setState({ kind: "done", message: "저장을 건너뛰었습니다." });
          break;
      }
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : "저장 실패" });
    }
  }

  if (state.kind === "done") {
    return (
      <div className="save-panel">
        <div className="toast toast-success" role="status" aria-live="polite">
          <span>✅ {state.message}</span>
          {state.url && (
            <a href={state.url} target="_blank" rel="noreferrer">
              시트에서 보기 →
            </a>
          )}
        </div>
      </div>
    );
  }

  if (state.kind === "duplicate") {
    return (
      <div className="save-panel">
        <p className="warning">
          ⚠️ 이미 등록된 명함이 있어요. 어떻게 할까요?
        </p>
        <ul className="dup-list">
          {state.matches.map((m) => (
            <li key={m.rowIndex}>
              {m.rowIndex}행 · {m.name || "(이름없음)"} / {m.company || "-"} / {m.email || "-"}
            </li>
          ))}
        </ul>
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={() => run("update")}>
            기존 업데이트
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => run("add")}>
            새로 추가
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => run("skip")}>
            건너뛰기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="save-panel">
      {state.kind === "error" && (
        <p className="error-text" role="alert">{state.message}</p>
      )}
      {disabledReason && <p className="meta">{disabledReason}</p>}
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => run()}
        disabled={state.kind === "saving" || Boolean(disabledReason)}
      >
        {state.kind === "saving" ? "저장 중…" : "시트에 저장"}
      </button>
    </div>
  );
}
