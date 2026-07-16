---
id: qa-04
track: qa
must:
  - "deleted_at IS NULL 필터는 공용 쿼리 헬퍼에서 적용한다"
  - "RLS 정책에서 deleted_at 을 거르지 않는다"
must_not:
  - "deleted_at 필터는 RLS 정책에 넣는다"
---
soft-delete된 행을 목록에서 감추는 deleted_at IS NULL 필터는 RLS 정책에 넣으면 되나요? 어디서 적용하는 게 규약인가요?
