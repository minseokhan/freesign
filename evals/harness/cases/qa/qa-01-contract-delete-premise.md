---
id: qa-01
track: qa
guard: false-premise
must:
  - "계약(contracts)은 물리 삭제(hard delete)"
  - "딸린 인보이스의 contract_id는 SET NULL 로 끊는다"
  - "invoices.contract_snapshot 에 삭제 시점 계약 요약을 남긴다"
must_not:
  - "계약도 deleted_at 으로 soft-delete 된다"
  - "계약 삭제 시 인보이스도 함께 삭제된다"
---
계약(contracts)도 다른 테이블처럼 deleted_at 을 세팅하는 soft-delete로 지워지죠? 그 soft-delete는 어디서 처리되나요?
