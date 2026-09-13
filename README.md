# tempo

가볍고 빠른 병렬 타이머 · 스톱워치.

**웹앱:** https://philaxis.github.io/minimal-timer/

## 사용

- 블록 클릭: 시작 / 일시정지. 완료된 타이머는 새로고침 후 다시 시작합니다.
- 새로고침: 가장 최근 설정 시간으로 초기화. 스톱워치는 0으로 초기화합니다.
- 설정: 이름·시간·타이머/스톱워치 모드, 복제, 삭제, 맨 앞으로 이동.
- 시간 설정 변경은 다음 새로고침부터 적용됩니다. 모드 변경은 즉시 초기화합니다.
- 실행 중 타이머의 `+1분`은 이번 실행만 연장합니다.
- 점 손잡이를 드래그하거나 손잡이에 포커스한 뒤 방향키로 순서를 바꿉니다.
- 로그인 없이 같은 브라우저에 저장됩니다. Google로 연결하면 기존 계정 목록과 합치고 기기 간 연동합니다.
- 알림은 기기별로 켜며 소리는 기본 꺼짐입니다. 아이폰에서는 홈 화면에 설치한 후 허용하세요.

## 로컬 실행

Node.js 24 이상.

```sh
npm ci
cp .env.example .env
npm run dev
```

Supabase 연결에는 `.env`에 프로젝트 URL, publishable key, VAPID public key가 필요합니다. 연결 설정 없이도 로컬 타이머는 사용할 수 있습니다.

```sh
npm test
npm run build
node tests/browser.mjs
```

브라우저 검증은 실행 중인 개발 서버와 `npx agent-browser`를 사용합니다. 외부 연결 검증용 `tests/cloud.mjs`, `tests/push.mjs`는 임시 익명 세션 파일을 사용하며 실제 프로젝트에 테스트 타이머를 만들었다가 지웁니다. `tests/database.sql`은 RLS·입력 검증·충돌 처리 확인 후 트랜잭션을 롤백합니다.

## 배포

`main`에 푸시하면 GitHub Actions가 테스트·빌드 후 Pages에 배포합니다. 저장소 Variables에 공개 프런트엔드 설정을 등록합니다:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_VAPID_PUBLIC_KEY`

이 값들은 브라우저에 공개되는 키입니다. Supabase secret/service-role 키와 VAPID private key는 넣지 않습니다. Pages의 `/minimal-timer/` 경로는 워크플로에서 지정합니다.

## Supabase

프로젝트: `minimal-timer` (`hgqntslhgrbwkmuqpfbr`).

- Google 및 Anonymous Sign-Ins 활성화.
- Site URL: `https://philaxis.github.io/minimal-timer/`
- Redirect URLs: 위 주소와 `http://localhost:5173/`.
- Google OAuth callback: `https://hgqntslhgrbwkmuqpfbr.supabase.co/auth/v1/callback`
- Google OAuth의 승인된 JavaScript 원본: `https://philaxis.github.io`, 로컬 개발 시 `http://localhost:5173`.

SQL은 `supabase/migrations/`에 있습니다. 타이머·알림 구독은 사용자별 RLS로 분리하고, 수정 시 revision을 비교해 다른 기기의 최신 변경을 덮어쓰지 않습니다. 네트워크가 끊긴 연결 모드에서는 시간은 계속 흐르되 저장이 필요한 조작을 잠시 막습니다. 다시 연결하면 서버 상태를 가져옵니다.

완료 알림은 `tempo-completion-push` Cron 작업이 5초 간격으로 확인하고, 만료된 타이머가 있을 때만 `tempo-push` Edge Function을 호출합니다. 호출용 비밀 값과 VAPID 키는 브라우저 접근을 금지한 `tempo_push_config`에 저장합니다. 발송 전용 함수는 비밀 헤더를 검증하고, 지연된 푸시는 표시 전 해당 실행이 여전히 완료 상태인지 확인합니다. 익명 로그인은 기기 알림용 계정을 만들며 Google로 연결된 상태로 표시하지 않습니다.

## 프로토타입 범위

온라인 푸시는 네트워크·OS 절전 정책·알림 권한의 영향을 받으므로 정각 전달을 보장하지 않습니다. 15분 이상 지난 알림은 보내지 않습니다. 비행기 모드에서 닫힌 앱의 알람, 통계, 반복 타이머, 별도 프리셋 관리, 네이티브 앱은 포함하지 않습니다. OS 알림 소리는 기기 설정에 따라 달라집니다.

브라우저 저장소 삭제 시 비로그인 데이터가 사라질 수 있습니다. 파싱할 수 없는 저장 데이터는 `.recovery` 키로 보존합니다. 공개 서비스 이용량이 늘어나면 익명 로그인 CAPTCHA와 사용량 제한을 프로젝트 환경에 맞게 설정하세요.
