# 명함 스캐너 (card-scanner)

컨설턴트용 명함 스캔 웹앱. 휴대폰으로 명함을 촬영하면 **Claude Vision**으로 구조화 JSON을 추출하고, **Naver CLOVA OCR**로 대조·보정한 뒤, 사용자가 확인·수정하여 **Google Sheets**에 저장합니다.

전체 흐름: **촬영/업로드 → 인식(`/api/scan`) → 검수·수정 폼(저신뢰 필드 강조) → 저장(`/api/save`)**.

## 기술 스택

- **client**: Vite + React 18 + TypeScript + PWA(`vite-plugin-pwa`), 모바일 우선
- **server**: Node.js + Express + TypeScript (`multer`, `sharp`, `zod`, `googleapis`, `dotenv`, `@anthropic-ai/sdk`)
- **shared**: 공통 타입/스키마(`BusinessCard` 등, `zod` 기반)
- 모든 외부 API 호출은 **서버에서만** 수행 → API 키가 프론트 번들에 노출되지 않음

## 폴더 구조

```
card-scanner/
├─ package.json          # npm workspaces (dev/build 스크립트)
├─ tsconfig.base.json    # TS strict 공통 설정
├─ .env.example          # 환경변수 목록(값 없음)
├─ .gitignore            # .env 등 비밀정보 제외
├─ shared/               # 공통 타입 + Zod 스키마
│  └─ src/{index.ts, businessCard.ts}
├─ server/               # Express API
│  └─ src/{index.ts, env.ts}
└─ client/               # React PWA
   ├─ public/favicon.svg
   └─ src/{main.tsx, App.tsx, index.css, vite-env.d.ts}
```

## 사전 준비

1. Node.js 20 이상 (`.nvmrc` 참고, `nvm use`)
2. 환경변수 설정:
   ```bash
   cp .env.example .env
   # .env 를 열어 값 채우기 (아래 "환경변수" 참고)
   ```

## 설치 & 실행

```bash
# 1) 루트에서 전체 워크스페이스 설치
npm install

# 2) 개발 모드 (server + client 동시 실행)
npm run dev
#   - server: http://localhost:4000  (API)
#   - client: http://localhost:5173  (프론트, /api 는 서버로 프록시)

# 개별 실행
npm run dev:server
npm run dev:client

# 3) 프로덕션 빌드
npm run build

# 타입체크 / 테스트 (전체 워크스페이스)
npm run typecheck
npm run test
```

## 환경변수 (`.env`)

| 키 | 필수 | 설명 |
|---|---|---|
| `PORT` | - | 서버 포트(기본 4000) |
| `CORS_ORIGIN` | - | 허용 프론트 오리진(기본 `http://localhost:5173`) |
| `ANTHROPIC_API_KEY` | ● | Claude Vision 키 (1차 추출) |
| `ANTHROPIC_MODEL` | - | 비전 모델명(기본 `claude-3-5-sonnet-latest`) |
| `CLOVA_OCR_INVOKE_URL` / `CLOVA_OCR_SECRET_KEY` | ○ | CLOVA OCR (2차 폴백) |
| `USE_OCR_FALLBACK` | - | 폴백 사용 여부(기본 true) |
| `GOOGLE_SHEETS_CLIENT_EMAIL` / `GOOGLE_SHEETS_PRIVATE_KEY` | ● | 서비스 계정 자격증명 |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | ● | 저장 대상 시트 ID |
| `GOOGLE_SHEETS_TAB_NAME` | - | 기록할 탭 이름(기본 `명함`) |

> ● 다음 단계 기능 구현 시 필수, ○ 선택. **`.env` 는 절대 커밋하지 마세요.**

### Google Sheets 서비스 계정 설정(상세)

1. **프로젝트 & API 활성화**: [Google Cloud Console](https://console.cloud.google.com) 에서 프로젝트 선택 → "API 및 서비스 > 라이브러리" 에서 **Google Sheets API** 사용 설정.
2. **서비스 계정 생성**: "API 및 서비스 > 사용자 인증 정보 > 사용자 인증 정보 만들기 > 서비스 계정" → 이름 지정 후 생성. 역할은 없어도 됩니다(시트 공유로 권한 부여).
3. **키 발급(JSON)**: 생성된 서비스 계정 > "키" 탭 > "키 추가 > 새 키 만들기 > JSON". 내려받은 파일에서 `client_email` 과 `private_key` 를 확인합니다.
4. **.env 입력**:
   - `GOOGLE_SHEETS_CLIENT_EMAIL` = JSON 의 `client_email`
   - `GOOGLE_SHEETS_PRIVATE_KEY` = JSON 의 `private_key`. **줄바꿈을 `\n` 으로 이스케이프**해 한 줄로 넣고 전체를 큰따옴표로 감쌉니다.
     예: `GOOGLE_SHEETS_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"`
   - `GOOGLE_SHEETS_SPREADSHEET_ID` = 시트 URL `.../d/<이 부분>/edit`
   - `GOOGLE_SHEETS_TAB_NAME` = 기록할 탭 이름(범위 기준, 기본 `명함`)
5. **시트 공유(중요)**: 대상 스프레드시트를 열고 "공유"에서 위 **서비스 계정 이메일**(`...@...iam.gserviceaccount.com`)을 **편집자**로 추가합니다. 이 공유가 없으면 `SHEETS_PERMISSION` 오류가 납니다.

**OAuth 스코프**: 서버는 `https://www.googleapis.com/auth/spreadsheets` 스코프로 서비스 계정 JWT 인증을 사용합니다(읽기+쓰기). 사용자 로그인/브라우저 동의 흐름이 없어 무인 서버에 적합합니다.

## POST /api/save — Google Sheets 저장

확인·보정된 표준 JSON(`{ card, source?, onDuplicate? }`)을 받아 `spreadsheets.values.append` 로 새 행을 추가합니다.

- **헤더 자동 생성(최초 1회)**: `이름(한글) · 원본표기 · 회사 · 직책 · 주소 · 휴대폰 · 이메일 · 스캔시각`
- **중복 방지**: 이메일 또는 (회사+이름)이 이미 있으면 저장하지 않고 `status:"duplicate"` 와 매칭 행을 반환 → 프론트에서 **추가/건너뛰기/업데이트** 선택 후 `onDuplicate` 를 담아 재요청.

응답(성공 계열, `status` 로 구분):
```json
{ "ok": true, "status": "appended", "rowIndex": 5, "spreadsheetUrl": "https://docs.google.com/..." }
{ "ok": true, "status": "updated",  "rowIndex": 5, "spreadsheetUrl": "..." }
{ "ok": true, "status": "skipped" }
{ "ok": true, "status": "duplicate",
  "matches": [ { "rowIndex": 5, "name": "홍길동", "company": "가인지컨설팅그룹", "email": "gildong.hong@example.com" } ],
  "spreadsheetUrl": "..." }
```

에러 코드: `SHEETS_NOT_CONFIGURED`(설정 누락), `SHEETS_PERMISSION`(시트 미공유), `SHEETS_FAILED`(그 외), `INVALID_BODY`(형식 오류).

테스트(키 설정 후):
```bash
curl -s -X POST http://localhost:4000/api/save \
  -H "Content-Type: application/json" \
  -d '{"card":{"name":"홍길동","company":"가인지컨설팅그룹","email":"gildong.hong@example.com","contact":{"mobile":"010-1234-5678"}}}' | jq
# 같은 명함으로 한 번 더 → status:"duplicate" 확인 후
# -d '{"card":{...},"onDuplicate":"update"}' 로 재요청

## PWA / 카메라 참고
- 카메라(`getUserMedia`)와 PWA 설치는 **HTTPS(또는 localhost)** 에서만 동작합니다.
- 실기기 테스트는 `vite --host` + HTTPS 터널(예: 사설 인증서/터널)로 진행하세요.
- PWA 아이콘: `client/public/` 에 `pwa-192x192.png`, `pwa-512x512.png`, `apple-touch-icon.png` 를 추가하세요(미첨부 시 설치 아이콘만 누락, 빌드는 진행).

## 검증
```bash
npm run dev:server
curl http://localhost:4000/api/health
# → {"ok":true,"env":"development","integrations":{...}}
```
프론트(5173) 접속 시 서버 상태와 연동 설정 여부가 화면에 표시되면 정상입니다.

## POST /api/scan — 명함 추출 파이프라인

`multipart/form-data` 로 `image` 필드에 명함 이미지를 업로드하면 다음 순서로 처리합니다.

1. **sharp 전처리**: EXIF 회전 보정 → 장변 1600px 리사이즈 → 대비 향상(normalize)+윤곽 강화(sharpen) → JPEG 재인코딩
2. **1차 Claude Vision**: 이미지 → 표준 JSON(BusinessCard) 구조화 추출. 스키마 강제·추측 금지·로고 회사명 인식·영문→한글 이름 변환 규칙 적용(프롬프트는 `server/prompts/businessCardExtraction.ts`)
3. **2차 CLOVA OCR**(설정 시): 순수 텍스트 추출 후 LLM 결과와 대조 → 전화/이메일/회사명 보정 및 confidence 산정(`server/src/services/reconcile.ts`)
4. **Zod 검증** 후 표준 JSON 반환

### 성공 응답 예시 (200)
```json
{
  "card": {
    "name": "홍길동",
    "nameEn": "Gildong Hong",
    "company": "가인지컨설팅그룹",
    "department": "컨설팅본부",
    "title": "책임 컨설턴트",
    "contact": { "mobile": "010-1234-5678", "office": "02-555-1234", "fax": "02-555-1235" },
    "email": "gildong.hong@example.com",
    "website": "https://example.com",
    "address": "서울특별시 강남구 테헤란로 000",
    "memo": ""
  },
  "confidence": 0.93,
  "source": "merged",
  "rawText": "GAINGE CONSULTING GROUP 홍길동 ...",
  "warnings": []
}
```

### 실패 응답(에러 코드)
| HTTP | code | 상황 |
|---|---|---|
| 400 | `NO_IMAGE` | 이미지 미첨부 |
| 400 | `UPLOAD_ERROR` | 이미지가 아닌 파일 |
| 400 | `LIMIT_FILE_SIZE` | 8MB 초과 |
| 400 | `IMAGE_PROCESS_FAILED` | sharp 전처리 실패(손상 이미지 등) |
| 500 | `LLM_NOT_CONFIGURED` | `ANTHROPIC_API_KEY` 미설정 |
| 502 | `LLM_FAILED` / `LLM_PARSE_FAILED` | LLM 호출/파싱 실패 |
| 422 | `VALIDATION_FAILED` | 이름·회사명 모두 인식 실패 |

> 형식: `{ "ok": false, "code": "...", "message": "사용자 안내 한국어" }`. OCR(2차) 실패는 **비치명적**이라 LLM 결과로 진행하며 경고만 추가합니다.

### 샘플 이미지로 테스트하기
`samples/sample-card.jpg` 를 포함했습니다(합성 명함).

```bash
# 1) .env 에 ANTHROPIC_API_KEY(필수), 선택적으로 CLOVA_* 설정
npm run dev:server

# 2) 샘플 업로드
curl -s -F "image=@samples/sample-card.jpg;type=image/jpeg" \
  http://localhost:4000/api/scan | jq

# 키 미설정 시 동작 확인(파이프라인 배선/에러 처리):
#   → {"ok":false,"code":"LLM_NOT_CONFIGURED",...}
```

실기기에서는 프론트(5173)에서 촬영/업로드 → "인식하기" 로 동일 엔드포인트를 호출합니다.

### 단위 테스트
```bash
npm --workspace server run test   # reconcile 보정 + 시트 중복탐지(vitest)
```

## 검수/수정 화면
인식 직후 편집 가능한 폼이 뜹니다. 신뢰도가 낮은 필드(OCR 보정·불일치·핵심 누락)는 **노란색 + "확인 필요" 배지**로 강조되고 `aria-describedby` 안내가 붙습니다. 사용자가 확인·수정 후 **시트에 저장**을 누르면 `/api/save` 를 호출하고, 성공 시 토스트와 저장된 시트 링크를 보여줍니다. 이름/회사가 모두 비면 저장 버튼이 비활성화됩니다.

## 접근성 / 반응형
- 모든 입력에 `<label htmlFor>`, 저신뢰 필드는 `aria-invalid`+`aria-describedby`, 토스트는 `role="status"`, 에러는 `role="alert"`.
- 키보드 포커스는 `:focus-visible` 로 뚜렷하게 표시, 터치 타깃 최소 44px, 입력 폰트 16px(iOS 확대 방지).
- 모바일 우선 1열 → 600px 이상에서 2열 폼. `prefers-reduced-motion` 존중.
- 최상위 `ErrorBoundary` 로 렌더 예외 시 복구 화면 제공.

## 배포 가이드

> **HTTPS 필수**: 카메라(`getUserMedia`)와 PWA 설치는 보안 컨텍스트에서만 동작합니다. 아래 호스팅은 모두 기본 HTTPS 를 제공합니다.

**아키텍처**: 정적 프론트(client) + API 서버(server) 분리 배포. 프론트는 `/api/*` 를 서버 도메인으로 호출합니다.

### 1) 서버 — Render 또는 Fly.io
- **빌드**: `npm install && npm run build:shared && npm --workspace server run build`
- **시작**: `npm --workspace server run start` (= `node dist/src/index.js`)
- **환경변수**: `ANTHROPIC_API_KEY`, (선택)`CLOVA_*`, `GOOGLE_SHEETS_*`, 그리고 **`CORS_ORIGIN`= 프론트 배포 도메인**(예: `https://card-scanner.vercel.app`).
- Render: Web Service 생성 → Build/Start Command 위와 동일, 헬스체크 `/api/health`.
- Fly.io: `fly launch`(Node), 시크릿은 `fly secrets set ANTHROPIC_API_KEY=... GOOGLE_SHEETS_PRIVATE_KEY=...` 로 주입. `PORT` 는 플랫폼 제공값 사용.

### 2) 프론트 — Vercel 또는 Netlify
- **루트/베이스**: `client`
- **빌드**: `npm install && npm run build`(모노레포 루트에서) 또는 프로젝트 루트를 `client` 로 두고 `vite build`
- **출력 디렉터리**: `client/dist`
- **API 연결**: 프로덕션에선 dev 프록시가 없으므로 둘 중 하나를 선택
  - (a) 프론트 호스팅의 리라이트로 `/api/*` → 서버 도메인 프록시
    - Vercel `vercel.json`: `{ "rewrites": [{ "source": "/api/:path*", "destination": "https://<서버도메인>/api/:path*" }] }`
    - Netlify `netlify.toml`: `[[redirects]] from="/api/*" to="https://<서버도메인>/api/:path*" status=200 force=true`
  - (b) 또는 `client/src/lib/api.ts` 의 호출 베이스를 `VITE_API_BASE` 환경변수로 바꿔 서버 절대 URL 사용(+서버 `CORS_ORIGIN` 허용)
- 리라이트(a)를 쓰면 CORS 설정이 필요 없어 가장 단순합니다.

### 배포 체크리스트
- [ ] 서버 `CORS_ORIGIN` 에 실제 프론트 도메인 등록
- [ ] Google 서비스 계정 이메일을 대상 시트에 **편집자**로 공유
- [ ] `GOOGLE_SHEETS_PRIVATE_KEY` 의 `\n` 이스케이프 확인
- [ ] 프론트에서 `/api/health` 200 확인, 명함 1장 스캔→저장 스모크 테스트
- [ ] 모바일 실기기(HTTPS)에서 후면 카메라 권한 허용 확인
