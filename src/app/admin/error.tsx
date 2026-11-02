"use client";

import { useEffect } from "react";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[admin] page data failed", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-8">
      <div className="w-full max-w-lg rounded-2xl border border-stone-200 bg-white p-8 text-center shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">数据暂时不可用</p>
        <h1 className="mt-3 text-2xl font-semibold text-stone-900">后台页面加载失败</h1>
        <p className="mt-3 text-sm leading-6 text-stone-500">
          数据库连接可能正在恢复，当前页面没有执行任何保存或删除操作。请稍后重试。
        </p>
        <button
          className="mt-6 rounded-xl bg-stone-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-stone-800"
          onClick={reset}
          type="button"
        >
          重新加载
        </button>
      </div>
    </div>
  );
}
