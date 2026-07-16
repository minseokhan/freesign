---
id: qa-02
track: qa
must:
  - "getUser() 를 쓴다"
  - "getSession() 은 인가 경계로 쓰지 않는다"
must_not:
  - "getSession() 으로 인가를 확인한다"
  - "middleware 가 보안 경계다"
---
Server Action에서 사용자 인가를 확인할 때 어떤 함수를 써야 하나요? middleware에 맡기면 되나요?
