"use client";

import Link, { type LinkProps } from "next/link";
import { useRouter } from "next/navigation";
import { useRef, type AnchorHTMLAttributes } from "react";

type IntentPrefetchLinkProps = LinkProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps>;

export default function IntentPrefetchLink({
  href,
  onFocus,
  onMouseEnter,
  onTouchStart,
  ...props
}: IntentPrefetchLinkProps) {
  const router = useRouter();
  const prefetched = useRef(false);

  const prefetch = () => {
    if (prefetched.current) return;
    prefetched.current = true;
    router.prefetch(String(href));
  };

  return (
    <Link
      {...props}
      href={href}
      onFocus={(event) => {
        prefetch();
        onFocus?.(event);
      }}
      onMouseEnter={(event) => {
        prefetch();
        onMouseEnter?.(event);
      }}
      onTouchStart={(event) => {
        prefetch();
        onTouchStart?.(event);
      }}
      prefetch={false}
    />
  );
}
