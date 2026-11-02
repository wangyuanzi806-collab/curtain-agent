"use client";

import { LOCALES, LOCALE_LABELS, useLocale } from "@/lib/i18n";

/**
 * 四种语言由 LOCALES 一处定义，这里不再写死按钮。
 * 原先是手写的「中 | EN」两颗，加语言要改三个地方还容易漏。
 */
export default function LanguageToggle({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale } = useLocale();

  return (
    // 「中」是切换器自己的按钮文本，同时也是色板"中等深浅"标签的翻译键——
    // DOM 扫描器按精确文本匹配，NL/FR 下这颗按钮会被连带翻成 "Medium"/"Moyen"。
    // data-no-translate 让扫描器跳过这整个子树，翻译层原生支持这个属性。
    <div className={`rz-language-toggle ${compact ? "is-compact" : ""}`} aria-label="Interface language" data-no-translate>

      {LOCALES.map((code, index) => (
        <span key={code} className="rz-language-slot">
          {index > 0 ? <i aria-hidden="true" /> : null}
          <button
            aria-pressed={locale === code}
            className={locale === code ? "is-active" : ""}
            lang={code}
            onClick={() => setLocale(code)}
            type="button"
          >
            {LOCALE_LABELS[code]}
          </button>
        </span>
      ))}
    </div>
  );
}
