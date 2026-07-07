# Step 4: generated-types

## 읽어야 할 파일

- `/docs/ADR.md` — ADR-002(**Supabase CLI 생성 타입** 사용, 수동 타입 아님)
- `/docs/ARCHITECTURE.md` — 데이터 모델(생성 타입이 반영해야 할 스키마)
- phase 0 산출물: `src/types/database.ts`(교체 대상 빈 스텁), `src/lib/supabase/server.ts`·`src/lib/supabase/client.ts`(`Database` 제네릭 사용처 — 생성 타입과 호환돼야 build 통과)
- phase 1 step 0~3 산출물: `src/test/pg.ts`(임베디드 PG 기동·마이그레이션 적용), `supabase/migrations/*.sql`(introspect 대상)

## 작업

마이그레이션이 적용된 **로컬 임베디드 Postgres를 introspection**해 `src/types/database.ts`를 실제 생성 타입으로 교체한다. 손으로 타입을 쓰지 않는다.

1. `supabase` CLI를 **devDependency**로 추가한다.
2. 생성 스크립트를 만든다(예: `scripts/gen-types.mjs` — `.mjs`는 `.codex` TDD 가드 예외) + `package.json`에 `"db:gen-types"` 스크립트 등록:
   - step 0 harness로 임베디드 PG 기동 → auth 부트스트랩 → `supabase/migrations/*.sql` 적용.
   - `npx supabase gen types typescript --schema public --db-url postgresql://.../postgres` 를 실행하고 stdout을 `src/types/database.ts`에 기록.
   - **`--schema public`만** 생성한다(auth 스텁 테이블·roles가 타입에 새지 않게).
   - 완료 후 임베디드 PG 종료.
3. 파일 상단의 "phase 1에서 교체" 스텁 주석을 제거하고, 생성 결과로 파일을 덮어쓴다.
4. `Database` 타입 shape(`public.Tables.<table>.Row/Insert/Update`, `public.Enums`)이 `server.ts`/`client.ts` 제네릭과 호환돼 **`npm run build`가 통과**하는지 확인한다.

주의: 생성된 `database.ts`는 **커밋 대상 산출물**이다(런타임에 재생성하지 않는다). 스크립트는 스키마 변경 시 재생성하는 개발 편의용이다.

## Acceptance Criteria

```bash
npm run db:gen-types   # 임베디드 PG introspection → src/types/database.ts 재생성
npm run lint
npm run build          # 생성 타입으로 타입 에러 없이 빌드
npm test               # 기존 통합·단위 테스트 green
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - `database.ts`에 6개 테이블이 `Row`/`Insert`/`Update`로 존재하고, enum(`contract_status`·`withholding_type`·`payment_status`)이 반영됐는가?
   - `auth.users` 스텁·비-public 스키마가 타입에 새지 않았는가(public만)?
   - `npm run build`가 생성 타입으로 통과하는가?
3. `phases/1-database/index.json`의 step 4를 업데이트:
   - 성공 → `completed` + `summary`
   - `supabase` CLI 바이너리를 받을 수 없어 생성이 근본적으로 불가 → `blocked` + `blocked_reason`(단, `npx supabase`·재시도를 먼저 시도한 뒤에만)
   - 그 외 실패 → `error`

## 금지사항

- `src/types/database.ts`를 손으로 작성/편집하지 마라. 이유: 스키마 drift 위험. 반드시 마이그레이션 introspection으로 생성한다.
- auth/storage 등 비-public 스키마를 타입에 포함하지 마라. 이유: 앱은 public만 쓴다. 스텁이 새면 혼란과 잘못된 타입을 만든다.
- 스키마·정책·인덱스를 수정하지 마라. 이유: step 1~3의 확정본을 그대로 introspect해야 타입이 스키마와 일치한다.
- 기존 테스트를 깨뜨리지 마라.
