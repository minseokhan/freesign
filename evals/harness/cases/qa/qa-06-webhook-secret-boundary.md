---
id: qa-06
track: qa
guard: false-premise
must:
  - "세션 없는 경계(webhook·크론)에서도 service_role 은 금지다"
  - "anon 클라이언트로 p_*_secret 인자를 받는 SECURITY DEFINER RPC 를 호출한다"
  - "DEFINER 함수 내부에서 billing_config·cron_config 의 시크릿을 대조한다(fail-closed)"
must_not:
  - "세션이 없으니 service_role 키로 쓰면 된다"
  - "webhook 핸들러에서 테이블에 직접 UPDATE 한다"
---
Polar webhook 핸들러는 사용자 세션이 없어서 RLS에 막히는데, 이럴 땐 service_role 키를 써서 구독 상태를 직접 UPDATE 하면 되죠?
