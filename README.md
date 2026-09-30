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
npx wrangler d1 create anminam-wishlist --location=apac
```

출력된 `database_id`를 `wrangler.jsonc`의 all-zero UUID 자리에 넣습니다.

그 다음 스키마를 적용합니다.

```bash
npm run db:migrate:remote
```

## 3. R2 만들기

```bash
npx wrangler r2 bucket create anminam-wishlist-images --location=apac
```

`wrangler.jsonc`의 `WISH_IMAGES` 바인딩이 이 버킷을 사용합니다.

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
