"use client";

import { useState } from "react";

/**
 * 详情页的大图与缩略图。
 *
 * 原先这三个缩略图是服务端渲染的三个空 button——没有 onClick，`is-active`
 * 写死在第一个上。顾问点了没有任何反应，也就无从对照「原图」和「效果图」，
 * 而那正是这个页面存在的理由。
 */
export default function ConsultationGallery({
  images
}: {
  images: { src: string; label: string }[];
}) {
  const [active, setActive] = useState(0);
  const current = images[active] || images[0];

  return (
    <>
      <div className="rz-detail-image">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt={current.label} src={current.src} />
        <span>{current.label}</span>
      </div>
      <div className="rz-detail-thumbs">
        {images.map((image, index) => (
          <button
            aria-label={image.label}
            aria-pressed={index === active}
            className={index === active ? "is-active" : ""}
            key={image.label}
            onClick={() => setActive(index)}
            type="button"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt={image.label} src={image.src} />
          </button>
        ))}
      </div>
    </>
  );
}
