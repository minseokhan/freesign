# OWASP Top 10 2025 — 점검 카탈로그

각 카테고리는 **범용 체크**(어떤 웹앱이든)와 **스택 추가 체크**(Next.js App Router + Supabase 감지 시)로 구성된다.
스택 추가 체크는 매듭 `CLAUDE.md`의 CRITICAL 아키텍처 규칙을 OWASP에 매핑한 것으로, 같은 스택의 다른 레포에도 대체로 유효하다.
스택이 감지되지 않으면 범용 체크만 적용하고, 스택 추가 체크는 "N/A"로 처리한다.

> finder는 자기 카테고리 섹션만 정독하면 된다. 각 체크는 "무엇을 어떻게 찾는지"와 "왜 결함인지"를 담는다.

## 목차
- [A01 Broken Access Control](#a01-broken-access-control)
- [A02 Security Misconfiguration](#a02-security-misconfiguration)
- [A03 Software Supply Chain Failures](#a03-software-supply-chain-failures)
- [A04 Cryptographic Failures](#a04-cryptographic-failures)
- [A05 Injection](#a05-injection)
- [A06 Insecure Design](#a06-insecure-design)
- [A07 Authentication Failures](#a07-authentication-failures)
- [A08 Software or Data Integrity Failures](#a08-software-or-data-integrity-failures)
- [A09 Security Logging and Alerting Failures](#a09-security-logging-and-alerting-failures)
- [A10 Mishandling of Exceptional Conditions](#a10-mishandling-of-exceptional-conditions)

---

## A01 Broken Access Control
접근 통제 실패 — 권한/소유권 검증 누락으로 남의 데이터·기능에 접근. OWASP 1위, 웹 결함의 최대 축.

**범용 체크**
- IDOR: URL·body의 리소스 id(`/orders/:id`, `{ userId }`)로 조회/수정하면서 요청자 소유권을 서버에서 검증하지 않음.
- 함수 레벨 인가 누락: 관리자/특권 라우트·핸들러에 role 체크 없음. 클라이언트가 숨긴 UI를 API 직접 호출로 우회 가능.
- 인가를 클라이언트에서만: 서버가 재검증 없이 클라이언트 판단(숨긴 버튼, JWT의 role 클레임 무검증)을 신뢰.
- 경로 탐색·강제 브라우징: `../`, 예측 가능한 경로로 타인 파일 접근.
- CORS 과허용: `Access-Control-Allow-Origin: *` + credentials 허용.

**스택 추가 체크 (Supabase + Next.js)**
- RLS 스코프: 사용자 데이터 테이블 정책에 `USING`과 `WITH CHECK`가 **둘 다** `user_id = (select auth.uid())`로 걸려야 함. 하나라도 빠지면 결함(마이그레이션 SQL·정책 정의 확인). RLS 자체가 disable면 CRITICAL.
- `getUser()` vs `getSession()`: 서버 인가 판단에 `getSession()`을 쓰면 결함(토큰 위조 검증 안 됨). 인가는 반드시 `getUser()`.
- FK 참조 우회: invoice→contract/client 등 FK insert 전에 Server Action이 부모 리소스 소유권을 **재조회 검증**해야 함(FK는 RLS를 우회). client가 준 FK id를 검증 없이 insert하면 남의 리소스에 자식 붙이기 가능.
- 테넌트 스코프: RSC/쿼리가 `user_id` 필터 없이 전체 테이블을 읽으면(집계·목록) 결함. RLS가 방어선이지만 RLS 미설정 테이블이면 그대로 유출.
- middleware를 보안 경계로 오인: middleware는 토큰 갱신 전용. 인가 게이트를 middleware에만 두면 우회 가능.

---

## A02 Security Misconfiguration
보안 설정 오류 — 안전하지 않은 기본값, 불필요한 노출, 누락된 하드닝.

**범용 체크**
- 디버그/스택트레이스 노출: 프로덕션에서 상세 에러·디버그 모드 노출.
- 보안 헤더 누락: CSP, HSTS, X-Content-Type-Options, X-Frame-Options 등 부재.
- 비밀 값 하드코딩·커밋: 소스/설정 파일에 API 키·토큰·DB 비밀번호. `.env`가 gitignore되지 않음.
- 기본 자격증명·불필요한 기능 활성화: 샘플 페이지, 열린 관리 콘솔, 미사용 포트/서비스.
- 과도한 권한: 클라우드 버킷/DB 역할이 필요 이상 권한.

**스택 추가 체크 (Supabase + Next.js)**
- `service_role` 키가 요청 경로(`app/`, 라우트 핸들러, Server Action, `'use client'`)에 등장하면 CRITICAL — RLS를 전면 우회하는 마스터 키. 시드/CLI 스크립트 전용이어야 함.
- `NEXT_PUBLIC_` 접두사 오용: 서버 전용 비밀(anon 외 키, 서명 시크릿)이 `NEXT_PUBLIC_`로 노출되면 번들에 박혀 클라이언트로 유출.
- Storage 버킷 설정: private 버킷 + `{user_id}/...` 경로여야 함. public 버킷·경로에 user_id 누락·영구 public URL 노출은 결함. DB엔 key만 저장, 읽기는 단기 signed URL.
- RLS 미활성 테이블: 사용자 데이터 테이블에 `enable row level security`가 없으면 anon 키로 전체 조회 가능(A01과 겹침, 설정 관점에서 재확인).
- Next config: `images.remotePatterns`/`dangerouslyAllowSVG`, 열린 rewrites/redirects, `headers()` 보안 헤더 누락.

---

## A03 Software Supply Chain Failures
소프트웨어 공급망 실패 — 의존성·서드파티·빌드 파이프라인을 통한 침해. 2025 신설 상위 항목.

**범용 체크**
- 알려진 취약 의존성: `package.json`/lockfile에 CVE 있는 버전 고정. (가능하면 `npm audit` 결과 참고, 없으면 눈에 띄는 구식·취약 패키지 플래그.)
- lockfile 부재·불일치: `package-lock.json`/`pnpm-lock.yaml`이 없어 재현 불가능한 설치.
- 위험한 install 스크립트: 의존성의 `postinstall`/`preinstall`이 임의 코드 실행(타이포스쿼팅·의심 패키지).
- 범위 넓은 버전 범위: `^`/`*`/`latest`로 무결성 검증 없이 최신을 끌어옴.
- 신뢰 안 되는 소스: git URL/tarball 직접 참조, 내부 미러 없는 사설 스코프.

**스택 추가 체크 (Next.js)**
- Next.js/React/Supabase SDK 버전이 알려진 취약 릴리스인지(예: 특정 Next.js SSR 취약점 대역).
- CI/배포 설정(`.github/workflows`, `vercel.json`)에서 검증 없는 서드파티 액션 `@main` 참조, 시크릿 과노출.

---

## A04 Cryptographic Failures
암호 실패 — 민감 데이터의 부적절한 보호(약한 암호·평문 전송·저장).

**범용 체크**
- 평문 저장·전송: 비밀번호·토큰·PII를 해시/암호화 없이 저장, HTTP로 전송.
- 약한 알고리즘: MD5/SHA1로 비밀번호 해싱, ECB 모드, 하드코딩 IV/키, `Math.random()`으로 토큰 생성.
- 비밀번호 해싱 부재: bcrypt/scrypt/argon2 대신 단순 해시 또는 무해싱.
- 민감정보 로깅·노출: 응답/로그/URL 쿼리스트링에 토큰·PII 포함.
- 잘못된 TLS: 인증서 검증 비활성화, 혼합 콘텐츠.

**스택 추가 체크 (매듭 도메인)**
- 서명 무결성: 계약 `doc_hash`·`signature_meta`가 서버에서 생성되고 위변조 검증 가능한지. 클라이언트가 해시를 주입하거나 재계산 검증이 없으면 서명 증빙 붕괴(방어 가능한 코어).
- signed URL TTL: Storage 읽기 URL이 장기/영구가 아니라 단기여야 함. 긴 TTL·URL DB 저장은 유출 창 확대.
- PII 스코프: 클라이언트·사업자번호·계좌 등 민감 필드가 응답/로그/CSV에 불필요하게 포함되는지.
- 시크릿 생성/보관: 서명 해시·웹훅 시크릿이 서버 전용 모듈에서만 다뤄지는지(A02 service_role과 연계).

---

## A05 Injection
인젝션 — 미검증 입력이 인터프리터로 흘러 들어가 명령/쿼리 실행. XSS 포함.

**범용 체크**
- SQL 인젝션: 문자열 연결·템플릿 리터럴로 만든 raw SQL에 사용자 입력. 파라미터 바인딩·ORM 미사용.
- XSS: `dangerouslySetInnerHTML`, `innerHTML`, 이스케이프 없는 사용자 콘텐츠 렌더. 리액트 밖 DOM 직접 조작.
- 커맨드 인젝션: `exec`/`spawn`/`eval`에 사용자 입력 결합.
- 경로/템플릿/LDAP/NoSQL 인젝션: 파일 경로·템플릿·필터에 미검증 입력.
- 입력 검증 부재: 신뢰 경계(라우트 핸들러·액션)에서 스키마 검증 없이 입력 사용.

**스택 추가 체크 (Supabase + Next.js + Claude)**
- Server Action zod allowlist: 액션이 **도메인 필드만** 담은 zod로 입력받아야 함. 미검증 `formData`/body 직접 사용, 또는 서버 소유 필드(`status`·`paid_at`·`doc_hash`·`signature_meta`·`is_demo`·금액 스냅샷·pdf 경로)가 클라이언트 입력 스키마에 있으면 결함(과잉 신뢰 → mass assignment).
- Supabase raw SQL/RPC: `.rpc()`·raw SQL에 사용자 입력을 문자열로 끼워넣는지. 필터 `.eq/.in` 값에 미검증 입력이 그대로.
- 프롬프트 인젝션: Claude 계약서 초안 등 LLM 호출에서 사용자 입력이 시스템 지시를 덮어쓸 수 있는지. 결과는 항상 "초안"으로만 취급.
- CSV/PDF 생성: CSV 수식 인젝션(`=`,`+`,`-`,`@`로 시작하는 셀), PDF 템플릿에 이스케이프 없는 입력.

---

## A06 Insecure Design
안전하지 않은 설계 — 구현 버그가 아니라 통제 자체의 부재·설계 결함.

**범용 체크**
- 비즈니스 로직 남용: 수량/금액 음수, 가격 조작, 순서 뒤바꾸기로 상태 악용. 서버 재검증 없는 결제/할인 흐름.
- 레이트리밋·안티오토메이션 부재: 로그인·OTP·비밀 재설정·비싼 엔드포인트에 제한 없음(무차별 대입·자원 고갈).
- 안전하지 않은 워크플로우: 다단계 흐름에서 단계 건너뛰기·재사용(토큰 1회성 미보장).
- 신뢰 경계 혼동: 클라이언트가 계산/결정한 값을 서버가 그대로 신뢰(금액·권한·상태).

**스택 추가 체크 (매듭 도메인)**
- 서버 소유 필드 설계: `status`·`paid_at`·`doc_hash`·`signature_meta`·`is_demo`·금액 스냅샷·pdf 경로는 클라이언트가 절대 정할 수 없어야 함(설계 차원에서 액션 시그니처가 이를 받도록 되어 있으면 결함).
- 상태 전이 설계: 계약 status·인보이스 결제가 append-only 이벤트 로그와 함께 기록되도록 설계됐는지(A08과 연계). 이벤트 없는 직접 UPDATE만 있으면 감사 불가.
- AI 게이트 오용: AI 계약서가 필수 게이트로 설계되면 실패 시 흐름 붕괴. AI는 보강이어야 하고 실패 시 골격 폴백. 면책 노출 없으면 설계 결함.
- Provider 추상화: 전자서명·결제가 `services/` v1 Provider 인터페이스 뒤로만 접근하도록 설계됐는지. 구현 직접 결합은 교체·검증 어려움.

---

## A07 Authentication Failures
인증 실패 — 신원 확인의 부재·약점(자격증명·세션·복구).

**범용 체크**
- 약한 세션 관리: 세션 고정, 예측 가능·미만료 토큰, 로그아웃 후 세션 무효화 안 됨.
- 자격증명 취약: 약한 비밀번호 정책, 무제한 로그인 시도(레이트리밋 부재 → A06과 연계), 크리덴셜 스터핑 무방비.
- 안전하지 않은 토큰 저장: JWT/세션을 `localStorage`에 저장(XSS 탈취), 쿠키에 `HttpOnly`/`Secure`/`SameSite` 미설정.
- 복구 흐름 취약: 비밀번호 재설정 토큰 재사용·장기 유효·추측 가능.
- 다단계·OAuth 오설정: state 파라미터 미검증(CSRF), redirect_uri 과허용.

**스택 추가 체크 (Supabase Auth + Next.js)**
- `getUser()` 강제: 서버에서 신원 확인은 `getUser()`(네트워크로 토큰 검증). `getSession()`은 쿠키의 미검증 클레임이라 인증 판단에 쓰면 결함.
- middleware 경계 오인: middleware는 토큰 갱신 전용이라 인증 게이트로 신뢰하면 안 됨(A01과 연계).
- OAuth redirect: Google OAuth 콜백 redirect·`emailRedirectTo`가 오픈 리다이렉트 아닌지. 허용 도메인 화이트리스트.
- 세션 쿠키: `@supabase/ssr` 쿠키 설정이 `Secure`/`HttpOnly`/`SameSite`를 유지하는지, 커스텀 핸들링이 이를 약화하지 않는지.

---

## A08 Software or Data Integrity Failures
무결성 실패 — 검증되지 않은 소스/데이터/업데이트를 신뢰해 변조 유입.

**범용 체크**
- 안전하지 않은 역직렬화: 신뢰 안 되는 직렬화 데이터를 검증 없이 역직렬화(RCE·객체 주입).
- 무결성 검증 없는 업데이트: 서명·해시 검증 없이 원격 코드/설정/모델 로드.
- CI/CD 파이프라인 무결성: 빌드 산출물·배포에 무결성 검증 부재(A03과 인접).
- 자동 업데이트·플러그인: 서명 안 된 확장/플러그인 로드.

**스택 추가 체크 (매듭 도메인)**
- 이벤트 로그 순서: 상태 전이는 **도메인 UPDATE 후 이벤트 INSERT를 순차**로. status 변경을 쓰기 순서 앞쪽에 두면 부분 실패 시 미완 상태(이벤트 없는 status)로 무결성 붕괴.
- append-only 보장: 이벤트 로그가 append-only인지(UPDATE/DELETE 정책 차단). 로그 변조 가능하면 감사 증빙 무력화.
- 스냅샷 무결성: 계약 물리삭제 시 `invoices.contract_snapshot`(jsonb)에 삭제 시점 요약을 남기고 `contract_id`를 SET NULL로 끊는지(ADR-008). 스냅샷 없이 삭제하면 추적 단절.
- soft-delete 무결성: `deleted_at IS NULL` 필터가 공용 쿼리 헬퍼 경유인지(복원·감사·CSV 보존). 개별 쿼리에서 누락하면 삭제 데이터 노출·집계 오염.

---

## A09 Security Logging and Alerting Failures
로깅·알림 실패 — 보안 이벤트를 남기지 않거나 탐지·대응 못 함.

**범용 체크**
- 보안 이벤트 미로깅: 로그인 실패·인가 거부·입력 검증 실패·권한 변경이 로그에 안 남음.
- 로그에 민감정보: 비밀번호·토큰·PII·전체 카드번호를 로그에 평문 기록(A04와 상충).
- 감사 추적 부재: 누가 언제 무엇을 바꿨는지 재구성 불가(도메인 이벤트 로그 없음).
- 알림·모니터링 부재: 이상 징후에 대한 경보·집계 없음. 로그 무결성(변조 방지) 없음.

**스택 추가 체크 (매듭 도메인)**
- 도메인 이벤트 커버리지: 상태 전이(계약 status·인보이스 결제)가 append-only 이벤트 로그에 남는지 — 감사·분쟁 대비 핵심(A08과 동전의 양면).
- 에러 로깅 위생: 서버 에러 로그에 `service_role`·토큰·서명 시크릿·PII가 새지 않는지. `console.error(err)`가 민감 payload를 통째로 찍는지.
- 실패의 가시성: catch 블록이 조용히 삼켜 로그도 남기지 않는지(A10과 연계) — 탐지 불가능.

---

## A10 Mishandling of Exceptional Conditions
예외 조건 처리 실패 — 2025 신설. 에러·엣지 조건을 잘못 다뤄 보안·정합성 붕괴.

**범용 체크**
- 에러 삼킴: `catch {}`·빈 catch로 실패를 무시하거나 실패를 성공으로 처리. 실패 경로가 조용히 계속 진행.
- fail-open: 인가/검증 로직이 예외 시 통과(deny 대신 allow). try 안에서 권한 체크가 던지면 우회.
- 상세 에러 노출: 스택트레이스·내부 경로·SQL을 클라이언트에 그대로 반환(A02와 연계, 여기선 예외 처리 관점).
- 부분 실패·비원자성: 다단계 쓰기 중간 실패 시 롤백/보상 없이 미완 상태 잔존. 리소스 누수(미해제 핸들·연결).
- 엣지 미처리: null/빈 배열/0/음수/오버플로/중복 제출/동시성 경계에서 잘못된 분기.

**스택 추가 체크 (매듭 도메인)**
- 상태 전이 부분 실패: 도메인 UPDATE 후 이벤트 INSERT 사이 실패 시 미완 상태 방지 설계인지(A08과 연계). status를 앞에 두면 예외 시 이벤트 없는 status 잔존.
- AI 폴백: Claude 초안 실패 시 골격 폴백으로 흐름 유지하는지(예외를 사용자 흐름 차단으로 만들지 않기).
- 액션 에러 반환: Server Action이 예외를 삼키고 성공으로 반환하거나, 반대로 내부 에러 메시지를 클라이언트에 그대로 노출하는지.
- 경계값: 금액/세금 계산에서 0·음수·반올림·통화 경계가 스냅샷과 어긋나거나 검증을 깨는지.

---

## 심각도 기준
- **critical**: 데이터 유출/타인 데이터 접근·수정, 인증·인가 우회, RCE, service_role 노출. 즉시 악용 가능.
- **high**: 조건부 악용 가능한 인가/암호/인젝션 결함. 릴리스 전 반드시 수정.
- **medium**: 방어선이 하나 남아 있으나 하드닝 필요(헤더 누락, 약한 설정, 로깅 공백).
- **low**: 심층 방어·모범사례 미준수. 실익 낮지만 개선 권장.
- **info**: 결함은 아니나 검토할 관찰(설계 노트, 잠재 리스크).
