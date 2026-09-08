import Image from "next/image";

import { cn } from "@/lib/utils";

type LogoProps = {
  className?: string;
};

/**
 * 매듭 워드마크. 브랜드 원본 이미지(public/brand/logo-light.png)를 그대로 쓴다.
 *
 * 원본은 764×326에 사방 49px 여백이 포함돼 있어, 글자 자체는 지정한 높이의
 * 약 70%로만 보인다. 호출부에서 높이를 정할 때 이 여백을 감안할 것.
 */
export function Logo({ className }: LogoProps) {
  return (
    <Image
      src="/brand/logo-light.png"
      alt="매듭"
      width={764}
      height={326}
      priority
      className={cn("h-9 w-auto", className)}
    />
  );
}
