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

상품 URL을 넣고 `정보 불러오기`를 누르면 Worker가 다음 순서로 상품 정보를 찾습니다.

1. JSON-LD Product
2. Open Graph (`og:title`, `og:image`)
3. `product:price:*` 메타 태그
4. `<title>`

쇼핑몰이 자동 접근을 차단하면 자동 입력은 실패할 수 있으며, 이때는 수동으로 입력하면 됩니다.

## 이미지 처리

위시 저장 시 원본 이미지 URL을 가져와 R2에 복사합니다. 따라서 교보문고/무신사 등 원본 사이트의 핫링크 정책에 덜 영향을 받습니다.

관리자 모드에서는 자동 조회 대신 JPG, PNG, WebP, GIF, AVIF 이미지를 직접 올릴 수도 있습니다. 업로드 크기는 8MB로 제한됩니다.

## 제공 기능

- 상품명·메모·태그 검색, 카테고리 필터, 가격·등록일·우선순위 정렬
- 갖고 싶음, 구매 완료, 보관 상태 관리
- 우선순위, 목표 가격, 태그, 공개 범위 설정
- 공개·링크 공개·비공개 컬렉션과 개별 위시 공유
- 방문자의 선물 준비 표시와 30일 후 자동 만료
- JSON 전체 백업·복원과 CSV 내보내기
- 가격 이력, 목표 가격 도달 및 가격 하락 사이트 내 알림
- 카드·컴팩트·리스트 보기와 모바일 레이아웃

## 가격 확인 자동화

`wrangler.jsonc`에는 매일 `18:20 UTC`(한국 시간 오전 3시 20분)에 실행되는 Cron Trigger가 설정되어 있습니다. 가격 추적을 켠 위시 중 오래 확인하지 않은 항목을 한 번에 최대 12개 확인합니다.

로컬에서는 개발 서버를 실행한 뒤 다음 URL로 Scheduled Handler를 확인할 수 있습니다.

```bash
curl "http://localhost:5173/cdn-cgi/local/scheduled?format=json"
```

쇼핑몰이 자동 접근을 차단하거나 상품 페이지 구조를 변경하면 가격을 읽지 못할 수 있습니다. 가격 확인 실패는 기존 가격을 덮어쓰지 않습니다.

## 기능 마이그레이션

검색·상태·컬렉션·태그·예약·가격 이력에 필요한 스키마는 `migrations/0002_wishlist_features.sql`에 있습니다.

로컬 적용:

```bash
npm run db:migrate:local
```

원격 적용은 배포 전 백업을 확인한 뒤 명시적으로 실행합니다.

```bash
npm run db:migrate:remote
```
