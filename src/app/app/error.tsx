"use client";

import { useEffect } from "react";

/**
 * 顾问侧的错误兜底。
 *
 * 此前这一段没有 error.tsx：服务端组件里任何一次查库失败，客户就直接看到
 * 一片空白加一句 "Application error ... Digest: 961527307"——顾问当着客户的面
 * 拿到这个，既不知道发生了什么，也不知道方案有没有存住。后台早就有这个兜底，
 * 顾问侧反而没有。
 *
 * 这一屏只负责说清三件事：出了什么事、方案在不在、现在能做什么。
 */
export default function AppError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] page data failed", error);
  }, [error]);

  return (
    <div className="rz-page">
      <div className="rz-empty-state" style={{ maxWidth: 520, margin: "12vh auto" }}>
        <span className="rz-eyebrow">页面没能打开</span>
        <strong>这一页的数据没读出来</strong>
        <p>
          多半是数据库连接一时挤不进去，稍等一下再试通常就好了。
          <br />
          你的方案已经保存过了，这一步没有改动或删除任何内容。
        </p>
        <button onClick={reset} type="button">
          重新加载这一页
        </button>
        {error.digest ? (
          <small style={{ marginTop: 12, color: "var(--rz-text-faint)", fontSize: 11 }}>
            排查编号 {error.digest}
          </small>
        ) : null}
      </div>
    </div>
  );
}
