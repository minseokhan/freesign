import { z } from "zod";

/**
 * 계정 삭제 확인 문구. UI 입력 검사와 Server Action 검증이 같은 값을 봐야 하므로
 * 한 곳에 둔다. "use server" 파일은 async 함수만 export할 수 있어 여기에 있다.
 */
export const ACCOUNT_DELETE_CONFIRM_PHRASE = "계정을 삭제합니다";

export const deleteAccountInputSchema = z.object({
  confirm: z.literal(ACCOUNT_DELETE_CONFIRM_PHRASE),
});
