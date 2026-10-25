# 안미남 위시리스트 — Cloudflare native

현재 ChatGPT Site로 운영 중인 **안미남 위시리스트**를 Cloudflare 전용 구조로 옮기기 위한 프로젝트입니다.

## 구조

- React + Vite: 화면
- Cloudflare Worker: `/api/*`
- D1: 위시 데이터
- R2: 원본 쇼핑몰 이미지를 복사해 안정적으로 표시
- Workers Static Assets: 프론트 정적 파일
- GitHub → Cloudflare Workers Builds: push 자동 배포

## 1. 설치

```bash
npm install
npx wrangler login
```

## 2. D1 만들기

서울에서 사용하는 개인 사이트이므로 위치 힌트는 `apac`으로 시작합니다.

```bash
npx wrangler d1 create anminam-wish-db --location=apac
```

현재 Cloudflare 계정에는 `anminam-wish-db`가 생성되어 있으며, `wrangler.jsonc`에는 해당 D1의 실제 ID가 설정되어 있습니다. 다른 계정에서 새로 설정할 때는 출력된 `database_id`를 설정 파일에 넣고 `database_name`과 마이그레이션 스크립트의 이름도 맞춥니다.

그 다음 스키마를 적용합니다.

```bash
npm run db:migrate:remote
```

## 3. R2 만들기

```bash
npx wrangler r2 bucket create anminam-wishlist-images --location=apac
```

`wrangler.jsonc`의 `WISH_IMAGES` 바인딩이 이 버킷을 사용합니다. 현재 대상 계정에는 APAC 위치 힌트와 Standard 스토리지 클래스로 생성되어 있으며 공개 접근은 꺼져 있습니다.

## 4. 쓰기용 관리자 토큰 설정

공개 조회는 가능하되 아무나 위시를 추가/삭제하지 못하도록 Worker secret을 둡니다.

```bash
npx wrangler secret put ADMIN_TOKEN
```

브라우저에서 위시를 추가할 때 같은 토큰을 입력합니다. 토큰은 `sessionStorage`에만 보관되어 탭을 닫으면 사라집니다.

## 5. 로컬 실행

```bash
npm run dev
```

로컬 D1 스키마가 필요하면:

```bash
npm run db:migrate:local
```

## 6. 첫 배포

```bash
npm run deploy
```

## 7. GitHub 자동 배포 연결

1. 이 폴더를 GitHub 저장소에 push
2. Cloudflare Dashboard → **Workers & Pages** → **Create application**
3. **Import a repository** → GitHub 저장소 선택
4. Worker 이름은 반드시 `anminam-wishlist`로 설정
5. Build command: `npm run build`
6. Deploy command: `npx wrangler deploy`
7. Save and Deploy

이후 `main`에 push하면 Workers Builds가 자동 빌드/배포합니다.

## 기존 데이터 이전

현재 ChatGPT Site 안의 기존 위시 데이터 원본 저장소에는 이 환경에서 직접 접근할 수 없으므로, **기존 사이트를 바로 삭제하거나 교체하지 않습니다.** 새 Worker가 정상 동작하는 것을 확인한 뒤 기존 데이터를 JSON/CSV 등으로 확보하여 D1으로 이관하는 것이 안전합니다.

## 메타데이터 자동 입력

상품 추가의 `상품명 또는 링크`에 상품명을 입력하면 네이버 쇼핑 검색이 새 탭으로 열립니다. 원하는 상품의 **판매 페이지 링크**를 복사해 같은 입력창에 붙여넣고 `링크 확인`을 누릅니다.

미리보기에서 `이 상품으로 확정`을 누르면 아래 입력 폼에 반영됩니다. `다른 상품 선택` 또는 확정 후 `상품 다시 선택`으로 바꿀 수 있으며, 네이버 검색어는 모달을 닫기 전까지 유지됩니다. 확정은 저장과 별개이므로 내용을 확인한 뒤 `저장`을 눌러주세요.

네이버 검색 결과를 앱 안에서 자동 파싱하거나 선택한 링크를 자동 감지하지는 않습니다. 외부 검색 API 키는 필요하지 않습니다. 네이버에서 로그인이나 보안 확인이 필요할 수 있습니다.

URL의 `링크 확인`을 누르면 Worker가 다음 순서로 상품 정보를 찾습니다.

1. JSON-LD Product
2. Open Graph (`og:title`, `og:image`)
3. `product:price:*` 메타 태그
4. `<title>`

쇼핑몰이 자동 접근을 차단하면 자동 입력은 실패할 수 있으며, 이때는 수동으로 입력하면 됩니다.

## GPT Action 위시 등록 API

Custom GPT의 Actions에서 아래 OpenAPI 스키마를 가져오면 대화에서 위시를 등록할 수 있습니다.

- 스키마 URL: `https://anminam-wishlist.minamhunmin.workers.dev/gpt-wish-openapi.yaml`
- 인증 방식: API Key → Bearer
- 전용 경로: `POST /api/gpt/wishes`

API 키를 최소 32자의 무작위 값으로 만든 뒤 Worker secret으로 설정하고, 같은 값을 GPT Action의 Bearer API Key에 입력합니다.

```bash
openssl rand -hex 32
npx wrangler secret put GPT_WISH_API_KEY
```

이 API 키는 GPT Action 설정에만 보관하고 코드, 프롬프트, 저장소에 넣지 않습니다. API는 새 공개 위시 추가만 허용하며 조회·수정·삭제 기능은 제공하지 않습니다. 키가 설정되기 전까지 API는 `503`을 반환합니다.

## 이미지 처리

위시 저장 시 원본 이미지 URL을 가져와 R2에 복사합니다. 따라서 교보문고/무신사 등 원본 사이트의 핫링크 정책에 덜 영향을 받습니다.

관리자 모드에서는 자동 조회 대신 JPG, PNG, WebP, GIF, AVIF 이미지를 직접 올릴 수도 있습니다. 업로드 크기는 8MB로 제한됩니다.

## 제공 기능

- 상품명·메모·태그 검색, 카테고리 필터, 가격·등록일·우선순위 정렬
- 갖고 싶음, 구매 완료, 보관 상태 관리
- 완료 항목의 직접 구매·선물로 받음·기타 구분 및 수정 (기존 항목은 미기록 유지)
- 선물로 받은 항목은 월별 결제 금액 합계에서 제외
- 우선순위, 목표 가격, 태그, 공개 범위 설정
- 공개·링크 공개·비공개 컬렉션과 개별 위시 공유
- 방문자의 선물 준비 표시와 30일 후 자동 만료
- JSON 전체 백업·복원과 CSV 내보내기
- 가격 이력 상세 보기, 목표 가격 도달 및 가격 하락 사이트 내 알림
- 구매 예정 월과 월 예산 비교, 90일 지난 위시 재검토, 가격 확인 오류 대시보드
- 공유 컬렉션의 선물 예약 안내
- 카드·컴팩트·리스트 보기와 모바일 레이아웃

## 구매 계획과 사용 기록

관리자 상단의 **구매 계획**에서 다음 기능을 사용할 수 있습니다.

- **구매 후보**: 월별 후보를 선택하고 예산·구매 지출·예상 잔액을 확인한 뒤 구매 예정 월을 저장합니다. 기존 해당 월 예정 항목을 해제하면 예정 월이 비워집니다. 다른 월 후보를 선택하면 선택한 월로 옮깁니다. 원화만 합산하며 가격 미정과 외화는 별도로 안내합니다.
- **일괄 정리**: 갖고 싶은 항목 또는 보관함에서 최대 80개를 선택해 예정 월 변경·해제, 보관, 복귀를 적용합니다. 구매 완료 기록은 개별 항목에서 수정합니다.
- **사용 기록**: 만족도, 사용 상태, 짧은 후기를 기록합니다. 구매 30일 후 미기록 항목을 표시하며 한 달 미루기가 가능합니다. 전체 구매 완료 항목에서 기존 기록을 수정하거나 사용 기록만 지울 수 있습니다.
- **대체 상품 묶음**: 같은 목적의 후보 2~20개를 묶고 기존 비교 화면으로 최대 4개를 비교합니다. 개별 위시에서 구매 완료를 기록한 뒤, 보관할 다른 후보를 직접 선택할 수 있습니다. 묶음 삭제는 위시를 삭제하지 않습니다.

목록의 **현재 조건 저장**은 검색어·카테고리·상태·정렬·보기·컬렉션 조건을 이 브라우저에 최대 20개 저장합니다. 기기 간 동기화는 지원하지 않습니다.

사용 기록과 대체 상품 묶음은 관리자 인증이 필요한 별도 API에서만 조회합니다. JSON 백업·복원에 포함되며 공개 위시·공유 응답에는 포함되지 않습니다. 검색 조건은 브라우저 저장소에만 남습니다.

새 테이블은 `migrations/0006_decisions_and_experiences.sql`로 추가됩니다. 기존 위시 데이터와 구매 기록은 변경하지 않습니다.

## 가격 확인 자동화

`wrangler.jsonc`에는 매일 `18:20 UTC`(한국 시간 오전 3시 20분)에 실행되는 Cron Trigger가 설정되어 있습니다. 가격 추적을 켠 위시 중 오래 확인하지 않은 항목을 한 번에 최대 12개 확인합니다.

로컬에서는 개발 서버를 실행한 뒤 다음 URL로 Scheduled Handler를 확인할 수 있습니다.

```bash
curl "http://localhost:5173/cdn-cgi/local/scheduled?format=json"
```

쇼핑몰이 자동 접근을 차단하거나 상품 페이지 구조를 변경하면 가격을 읽지 못할 수 있습니다. 가격 확인 실패는 기존 가격을 덮어쓰지 않습니다.

취득 방법은 `migrations/0005_purchase_method.sql`에서 추가됩니다. 기존 금액과 완료 날짜는 보존됩니다. JSON 백업·복원 및 CSV 내보내기에 취득 방법도 포함됩니다.

## 기능 마이그레이션

검색·상태·컬렉션·태그·예약·가격 이력에 필요한 스키마는 `migrations/0002_wishlist_features.sql`에 있습니다. 구매 예정 월과 재검토 미루기 필드는 `migrations/0004_planning_and_review.sql`에서 추가됩니다.

로컬 적용:

```bash
npm run db:migrate:local
```

원격 적용은 배포 전 백업을 확인한 뒤 명시적으로 실행합니다.

```bash
npm run db:migrate:remote
```
