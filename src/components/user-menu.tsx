"use client";

import { useEffect, useRef, useState } from "react";
import posthog from "posthog-js";

import { signOut } from "@/app/(auth)/actions";
import { cn } from "@/lib/utils";

type UserMenuProps = {
  name: string;
  email: string;
  avatarUrl: string | null;
};

function getInitial(name: string, email: string) {
  const source = name.trim() || email.trim();
  if (!source) {
    return "?";
  }
  return Array.from(source)[0]!.toUpperCase();
}

export function UserMenu({ name, email, avatarUrl }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const showAvatar = Boolean(avatarUrl) && !avatarFailed;

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={name}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex min-h-11 items-center gap-sm rounded-full border border-surface-border bg-white py-1 pl-1 pr-md text-sm font-medium text-text-primary transition-colors",
          "hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2",
        )}
      >
        {showAvatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl!}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setAvatarFailed(true)}
            className="size-8 rounded-full object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex size-8 items-center justify-center rounded-full bg-brand-point text-sm font-semibold text-brand-primary"
          >
            {getInitial(name, email)}
          </span>
        )}
        <span className="hidden max-w-32 truncate sm:block">{name}</span>
      </button>

      {open ? (
        <div className="absolute right-0 z-20 mt-sm w-56 rounded-lg border border-surface-border bg-white p-1 shadow-overlay">
          <div className="border-b border-surface-border px-md py-sm">
            <p className="truncate text-sm font-medium text-text-primary">
              {name}
            </p>
            <p className="truncate text-xs text-text-muted">{email}</p>
          </div>
          <div role="menu" aria-label="계정 메뉴" className="p-1">
            <form action={signOut} onSubmit={() => posthog.reset()}>
              <button
                type="submit"
                role="menuitem"
                className="flex min-h-11 w-full items-center rounded-md px-md py-sm text-left text-sm font-medium text-red-600 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
              >
                로그아웃
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
