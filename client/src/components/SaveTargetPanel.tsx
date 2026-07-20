import { useCallback, useEffect, useState } from "react";
import {
  parseSpreadsheetId,
  type SheetMeta,
  type SheetSummary,
} from "@card-scanner/shared";
import {
  getSheetMeta,
  listSheets,
  addSheetTab,
  createSheet,
  type SaveTarget,
} from "../lib/api.js";

/**
 * 저장 대상(스프레드시트 + 탭) 선택/생성 패널.
 * - 공유 드라이브가 설정돼 있으면 팀 시트 목록을 드롭다운으로 제공 + 새 시트 생성.
 * - 아니면 URL로 시트 지정 + (개인용) 이메일 공유 생성.
 * - 선택값은 localStorage 에 저장해 다음 방문에도 유지합니다.
 */

const LS_KEY = "cardScanner.saveTarget";

function loadTarget(): SaveTarget {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as SaveTarget) : {};
  } catch {
    return {};
  }
}
function persistTarget(t: SaveTarget): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(t));
  } catch {
    /* 저장 실패 무시 */
  }
}
const toMsg = (e: unknown): string =>
  e instanceof Error ? e.message : "알 수 없는 오류가 발생했습니다.";

interface Props {
  onChange: (t: SaveTarget) => void;
}

export function SaveTargetPanel({ onChange }: Props) {
  const [target, setTarget] = useState<SaveTarget>(loadTarget);
  const [meta, setMeta] = useState<SheetMeta | null>(null);
  const [sharedDrive, setSharedDrive] = useState(false);
  const [sheetList, setSheetList] = useState<SheetSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sheetInput, setSheetInput] = useState("");
  const [showSheetInput, setShowSheetInput] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createDomain, setCreateDomain] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newTab, setNewTab] = useState("");
  const [showAddTab, setShowAddTab] = useState(false);

  useEffect(() => {
    onChange(target);
    persistTarget(target);
  }, [target, onChange]);

  const loadMeta = useCallback(async (spreadsheetId?: string) => {
    setBusy(true);
    setError(null);
    try {
      const m = await getSheetMeta(spreadsheetId);
      setMeta(m);
      setTarget((prev) => ({
        spreadsheetId: m.spreadsheetId,
        tabName:
          prev.tabName && m.tabs.includes(prev.tabName) ? prev.tabName : m.tabs[0],
      }));
    } catch (e) {
      setMeta(null);
      setError(toMsg(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const loadList = useCallback(async () => {
    try {
      const l = await listSheets();
      setSharedDrive(l.sharedDriveConfigured);
      setSheetList(l.sheets);
    } catch {
      /* 목록 실패는 치명적 아님 — URL 지정으로 폴백 가능 */
    }
  }, []);

  useEffect(() => {
    void loadList();
    void loadMeta(target.spreadsheetId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function applySheet() {
    const id = parseSpreadsheetId(sheetInput);
    if (!id) {
      setError("올바른 스프레드시트 URL 또는 ID가 아닙니다.");
      return;
    }
    setShowSheetInput(false);
    setSheetInput("");
    await loadMeta(id);
  }

  async function handleCreate() {
    setBusy(true);
    setError(null);
    try {
      const m = await createSheet(createTitle.trim() || "명함 스캔", {
        shareWithEmail: sharedDrive ? undefined : createEmail.trim() || undefined,
        shareWithDomain: createDomain || undefined,
      });
      setMeta(m);
      setTarget({ spreadsheetId: m.spreadsheetId, tabName: m.tabs[0] });
      setShowCreate(false);
      setCreateTitle("");
      setCreateEmail("");
      setCreateDomain(false);
      void loadList(); // 목록 갱신
    } catch (e) {
      setError(toMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleAddTab() {
    const name = newTab.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      const m = await addSheetTab(name, target.spreadsheetId);
      setMeta(m);
      setTarget((prev) => ({ ...prev, spreadsheetId: m.spreadsheetId, tabName: name }));
      setShowAddTab(false);
      setNewTab("");
    } catch (e) {
      setError(toMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="save-target" aria-label="저장 대상 선택">
      <h3>저장 대상</h3>

      {/* 스프레드시트 */}
      <div className="target-row">
        <span className="target-label">시트</span>
        <span className="target-value">
          {sharedDrive && sheetList.length > 0 ? (
            <select
              aria-label="팀 시트 선택"
              value={target.spreadsheetId ?? ""}
              onChange={(e) => e.target.value && loadMeta(e.target.value)}
              disabled={busy}
            >
              <option value="" disabled>시트 선택…</option>
              {sheetList.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          ) : meta ? (
            <a href={meta.spreadsheetUrl} target="_blank" rel="noreferrer">{meta.title}</a>
          ) : busy ? (
            "불러오는 중…"
          ) : (
            "지정 안 됨"
          )}
        </span>
      </div>
      <div className="actions target-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setShowCreate((v) => !v); setShowSheetInput(false); }} disabled={busy}>
          새 시트 만들기
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setShowSheetInput((v) => !v); setShowCreate(false); }} disabled={busy}>
          URL로 지정
        </button>
      </div>

      {showSheetInput && (
        <div className="target-inline">
          <label htmlFor="sheet-url">스프레드시트 URL 또는 ID</label>
          <input id="sheet-url" type="text" value={sheetInput} onChange={(e) => setSheetInput(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." />
          <button type="button" className="btn btn-primary btn-sm" onClick={applySheet} disabled={busy}>적용</button>
        </div>
      )}

      {showCreate && (
        <div className="target-inline">
          <label htmlFor="new-title">새 시트 제목</label>
          <input id="new-title" type="text" value={createTitle} onChange={(e) => setCreateTitle(e.target.value)} placeholder="명함 스캔" />
          {!sharedDrive && (
            <>
              <label htmlFor="new-email">공유받을 Google 이메일(권장)</label>
              <input id="new-email" type="email" value={createEmail} onChange={(e) => setCreateEmail(e.target.value)} placeholder="me@company.com" />
            </>
          )}
          <label className="checkbox-row">
            <input type="checkbox" checked={createDomain} onChange={(e) => setCreateDomain(e.target.checked)} />
            회사 전체(도메인)에 편집자로 공유
          </label>
          <button type="button" className="btn btn-primary btn-sm" onClick={handleCreate} disabled={busy}>만들기</button>
          {sharedDrive ? (
            <p className="field-note">공유 드라이브에 생성되어 팀 전원이 바로 볼 수 있습니다.</p>
          ) : (
            <p className="field-note">이메일을 넣지 않으면 서비스 계정 소유라 내 드라이브에서 보이지 않습니다.</p>
          )}
        </div>
      )}

      {/* 탭 */}
      <div className="target-row">
        <span className="target-label">탭</span>
        <span className="target-value">
          <select
            aria-label="저장할 탭 선택"
            value={target.tabName ?? ""}
            onChange={(e) => setTarget((prev) => ({ ...prev, tabName: e.target.value }))}
            disabled={!meta || busy}
          >
            {(meta?.tabs ?? []).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowAddTab((v) => !v)} disabled={!meta || busy}>
            ＋ 새 탭
          </button>
        </span>
      </div>

      {showAddTab && (
        <div className="target-inline">
          <label htmlFor="new-tab">새 탭 이름</label>
          <input id="new-tab" type="text" value={newTab} onChange={(e) => setNewTab(e.target.value)} placeholder="예: 2026상반기" />
          <button type="button" className="btn btn-primary btn-sm" onClick={handleAddTab} disabled={busy}>추가</button>
        </div>
      )}

      {error && <p className="error-text" role="alert">{error}</p>}
    </section>
  );
}
