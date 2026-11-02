"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { translateRoyalZenText } from "@/lib/royalzen-translations";

export type Locale = "zh" | "en" | "nl" | "fr";

/** 切换器按这个顺序排，也是校验存量偏好时的白名单 */
export const LOCALES: Locale[] = ["zh", "en", "nl", "fr"];

/**
 * 每个按钮写它自己语言的名字，不是缩写代码。
 *
 * 原先是「中 · EN · NL · FR」——三个拉丁字母缩写挨在一起，粗看像同一种东西反复了三次，
 * 客户分不清哪个是荷兰语哪个是法语。换成各自母语里的名字，客户认自己的语言名，
 * 不需要认字母缩写。
 */
export const LOCALE_LABELS: Record<Locale, string> = {
  zh: "中文",
  en: "English",
  nl: "Nederlands",
  fr: "Français"
};

/** 给 <html lang>，影响朗读、断词与浏览器的翻译提示 */
const HTML_LANG: Record<Locale, string> = {
  zh: "zh-CN",
  en: "en",
  nl: "nl",
  fr: "fr"
};

/**
 * 个人资料里存的是 BCP-47 长标签，界面用的是短码，两边要能互转。
 * 设置页原先直接写 `locale === "en" ? "en-US" : "zh-CN"`，多一种语言就串味。
 */
export const LOCALE_TAGS: Record<Locale, string> = {
  zh: "zh-CN",
  en: "en-US",
  nl: "nl-NL",
  fr: "fr-FR"
};

export const LOCALE_NAMES: Record<Locale, string> = {
  zh: "简体中文",
  en: "English",
  nl: "Nederlands",
  fr: "Français"
};

export function localeFromTag(tag: string): Locale {
  const hit = LOCALES.find((code) => LOCALE_TAGS[code] === tag);
  if (hit) return hit;
  const short = tag.slice(0, 2) as Locale;
  return LOCALES.includes(short) ? short : "zh";
}

type I18nCtx = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
};

/**
 * 荷兰语与法语暂时没有独立词条，缺的一律回落到英文而不是中文原文：
 * 对着荷兰客户，英文界面尚可用，中文界面等于没有界面。
 */
const dict: Partial<Record<Locale, Record<string, string>>> = {
  zh: {
    // — Header / Nav —
    "nav.step1": "上传场景",
    "nav.step2": "选面料",
    "nav.step3": "查看效果",
    "nav.admin": "管理后台",
    "nav.footer": "Curtain Studio · AI 窗帘效果预览",

    // — Step 1: Scene —
    "scene.step": "STEP 1 / 3",
    "scene.title": "上传场景，告诉我们你的喜好",
    "scene.subtitle": "上传房间照片，可以选择你喜欢的风格和颜色，也可以让 AI 帮你推荐",
    "scene.uploadTitle": "拍照或上传房间图片",
    "scene.uploadHint": "让窗户完整出现在画面中效果最佳",
    "scene.preview": "场景预览",
    "scene.changeImage": "点击更换",
    "scene.styleLabel": "风格偏好",
    "scene.optional": "可选，点击选中",
    "scene.colorLabel": "期望颜色",
    "scene.extraLabel": "补充需求",
    "scene.extraPlaceholder": "例如：想要自然垂坠的纱帘，不要太厚重，适合奶油风客厅...",
    "scene.btnManual": "自己选面料",
    "scene.btnAI": "AI 帮我推荐",

    // Style chips
    "style.modern": "现代简约",
    "style.cream": "奶油风",
    "style.nordic": "北欧",
    "style.luxury": "轻奢",
    "style.french": "法式",
    "style.japanese": "日式原木",
    "style.wabi": "侘寂风",
    "style.american": "美式",
    "style.coastal": "海岸风",
    "style.vintage": "中古风",

    // Color chips
    "color.offWhite": "米白",
    "color.cream": "奶油色",
    "color.lightGray": "浅灰",
    "color.darkGray": "深灰",
    "color.khaki": "卡其",
    "color.camel": "驼色",
    "color.fogBlue": "雾蓝",
    "color.darkGreen": "墨绿",
    "color.beanPink": "豆沙粉",
    "color.terracotta": "赤陶红",

    // — Step 2: Select —
    "select.step": "STEP 2 / 3",
    "select.titleAI": "AI 为你推荐",
    "select.titleManual": "选一款面料",
    "select.subtitleAI": "AI 正在分析你的家庭场景，智能推荐最匹配的面料和款式。你也可以手动更换",
    "select.subtitleManual": "点击面料卡片选中，我们会把它做成窗帘挂到你家的场景里",
    "select.aiLoading": "AI 正在分析你的场景...",
    "select.aiLoadingHint": "正在识别房间风格、窗户类型、光线环境，为你匹配最佳面料和款式",
    "select.cancel": "取消",
    "select.aiFailed": "AI 推荐失败",
    "select.aiFailedHint": "，你可以手动选择面料和款式",
    "select.aiLabel": "AI 智能推荐",
    "select.overridden": "已手动更改",
    "select.restore": "恢复AI推荐",
    "select.sceneAnalysis": "场景分析：",
    "select.fabricTag": "面料",
    "select.styleTag": "款式",
    "select.notSatisfied": "不满意？可在下方直接点击更换其他面料和款式",
    "select.chooseStyle": "选择帘型",
    "select.clickToChange": "点击可更换",
    "select.stylePrefix": "风格：",
    "select.colorPrefix": "颜色：",
    "select.loadingFabrics": "加载面料中...",
    "select.noFabrics": "暂无面料数据",
    "select.addFabrics": "请在管理后台添加面料",
    "select.noImage": "暂无图片",
    "select.noImageShort": "无图",
    "select.aiPick": "AI推荐",
    "select.recommended": "推荐",
    "select.btnBack": "上一步",
    "select.btnGenerate": "生成效果图",

    // — Step 3: Result —
    "result.step": "STEP 3 / 3",
    "result.generating": "正在生成效果图...",
    "result.done": "效果图已生成",
    "result.failed": "生成失败",
    "result.fabricLabel": "面料：",
    "result.generatingHint": "AI 正在生成窗帘效果图，大约需要 30-60 秒...",
    "result.retry": "重试",
    "result.videoTitle": "窗帘飘动视频",
    "result.videoBtn": "生成展示视频",
    "result.videoGenerating": "正在生成窗帘飘动视频，大约需要 1-2 分钟...",
    "result.changeFabric": "换一款面料",
    "result.restart": "重新开始",
    "result.downloadImage": "下载效果图",
    "result.downloadVideo": "下载视频",

    // — Step Style —
    "stepStyle.step": "STEP 2 / 4",
    "stepStyle.title": "选择窗帘款式",
    "stepStyle.subtitle": "选择你想要的帘型，不同款式适合不同的窗户和空间",
    "stepStyle.loading": "加载款式中...",
    "stepStyle.empty": "暂无窗帘款式",
    "stepStyle.addHint": "请在管理后台添加款式数据",
    "stepStyle.noImage": "无图",
    "stepStyle.btnBack": "上一步",
    "stepStyle.btnNext": "下一步选面料",

    // — Errors —
    "error.compress": "压缩失败",
    "error.imageLoad": "图片加载失败",
    "error.network": "网络请求失败",
  },
  en: {
    // — Header / Nav —
    "nav.step1": "Upload Scene",
    "nav.step2": "Select Fabric",
    "nav.step3": "View Result",
    "nav.admin": "Admin",
    "nav.footer": "Curtain Studio · AI Curtain Effect Preview",

    // — Step 1: Scene —
    "scene.step": "STEP 1 / 3",
    "scene.title": "Upload scene & tell us your preferences",
    "scene.subtitle": "Upload a room photo, choose your preferred style and color, or let AI recommend for you",
    "scene.uploadTitle": "Take or upload a room photo",
    "scene.uploadHint": "Best results when the window is fully visible",
    "scene.preview": "Scene preview",
    "scene.changeImage": "Change",
    "scene.styleLabel": "Style Preference",
    "scene.optional": "Optional, click to select",
    "scene.colorLabel": "Preferred Color",
    "scene.extraLabel": "Additional Notes",
    "scene.extraPlaceholder": "e.g. Want a naturally draping sheer curtain, not too heavy, for a cream-style living room...",
    "scene.btnManual": "Choose Fabric",
    "scene.btnAI": "AI Recommend",

    // Style chips
    "style.modern": "Modern Minimal",
    "style.cream": "Cream Style",
    "style.nordic": "Nordic",
    "style.luxury": "Light Luxury",
    "style.french": "French",
    "style.japanese": "Japanese Wood",
    "style.wabi": "Wabi-Sabi",
    "style.american": "American",
    "style.coastal": "Coastal",
    "style.vintage": "Mid-Century",

    // Color chips
    "color.offWhite": "Off White",
    "color.cream": "Cream",
    "color.lightGray": "Light Gray",
    "color.darkGray": "Dark Gray",
    "color.khaki": "Khaki",
    "color.camel": "Camel",
    "color.fogBlue": "Fog Blue",
    "color.darkGreen": "Dark Green",
    "color.beanPink": "Dusty Pink",
    "color.terracotta": "Terracotta",

    // — Step 2: Select —
    "select.step": "STEP 2 / 3",
    "select.titleAI": "AI Recommendation",
    "select.titleManual": "Choose a Fabric",
    "select.subtitleAI": "AI is analyzing your room to recommend the best fabric and style. You can also change manually",
    "select.subtitleManual": "Click a fabric card to select it. We'll render it as curtains in your room",
    "select.aiLoading": "AI is analyzing your scene...",
    "select.aiLoadingHint": "Identifying room style, window type, and lighting to find the best match",
    "select.cancel": "Cancel",
    "select.aiFailed": "AI Recommendation Failed",
    "select.aiFailedHint": ", you can manually select fabric and style",
    "select.aiLabel": "AI Recommendation",
    "select.overridden": "Manually changed",
    "select.restore": "Restore AI pick",
    "select.sceneAnalysis": "Scene Analysis: ",
    "select.fabricTag": "Fabric",
    "select.styleTag": "Style",
    "select.notSatisfied": "Not satisfied? Click below to choose different fabric and style",
    "select.chooseStyle": "Choose Style",
    "select.clickToChange": "Click to change",
    "select.stylePrefix": "Style: ",
    "select.colorPrefix": "Color: ",
    "select.loadingFabrics": "Loading fabrics...",
    "select.noFabrics": "No fabric data",
    "select.addFabrics": "Please add fabrics in admin panel",
    "select.noImage": "No image",
    "select.noImageShort": "N/A",
    "select.aiPick": "AI Pick",
    "select.recommended": "Recommended",
    "select.btnBack": "Back",
    "select.btnGenerate": "Generate Preview",

    // — Step 3: Result —
    "result.step": "STEP 3 / 3",
    "result.generating": "Generating preview...",
    "result.done": "Preview Ready",
    "result.failed": "Generation Failed",
    "result.fabricLabel": "Fabric: ",
    "result.generatingHint": "AI is generating your curtain preview, about 30-60 seconds...",
    "result.retry": "Retry",
    "result.videoTitle": "Curtain Motion Video",
    "result.videoBtn": "Generate Video",
    "result.videoGenerating": "Generating curtain motion video, about 1-2 minutes...",
    "result.changeFabric": "Change Fabric",
    "result.restart": "Start Over",
    "result.downloadImage": "Download Image",
    "result.downloadVideo": "Download Video",

    // — Step Style —
    "stepStyle.step": "STEP 2 / 4",
    "stepStyle.title": "Choose Curtain Style",
    "stepStyle.subtitle": "Different styles suit different windows and spaces",
    "stepStyle.loading": "Loading styles...",
    "stepStyle.empty": "No curtain styles",
    "stepStyle.addHint": "Please add styles in admin panel",
    "stepStyle.noImage": "N/A",
    "stepStyle.btnBack": "Back",
    "stepStyle.btnNext": "Next: Select Fabric",

    // — Errors —
    "error.compress": "Compression failed",
    "error.imageLoad": "Image load failed",
    "error.network": "Network request failed",
  },
  nl: {
    // — Header / Nav —
    "nav.step1": "Scène uploaden",
    "nav.step2": "Kies stof",
    "nav.step3": "Bekijk resultaat",
    "nav.admin": "Beheer",
    "nav.footer": "Curtain Studio · AI-gordijnvisualisatie",

    // — Step 1: Scene —
    "scene.step": "STAP 1 / 3",
    "scene.title": "Upload uw ruimte en vertel uw voorkeuren",
    "scene.subtitle": "Upload een kamerfoto, kies stijl en kleur, of laat AI een voorstel doen",
    "scene.uploadTitle": "Maak of upload een kamerfoto",
    "scene.uploadHint": "Beste resultaat als het raam volledig zichtbaar is",
    "scene.preview": "Scènevoorbeeld",
    "scene.changeImage": "Wijzigen",
    "scene.styleLabel": "Stijlvoorkeur",
    "scene.optional": "Optioneel, klik om te selecteren",
    "scene.colorLabel": "Gewenste kleur",
    "scene.extraLabel": "Aanvullende wensen",
    "scene.extraPlaceholder": "bijv. een natuurlijk vallende vitrage, niet te zwaar, voor een woonkamer in crèmestijl...",
    "scene.btnManual": "Zelf stof kiezen",
    "scene.btnAI": "AI-aanbeveling",

    // Style chips
    "style.modern": "Modern minimalistisch",
    "style.cream": "Crèmestijl",
    "style.nordic": "Scandinavisch",
    "style.luxury": "Ingetogen luxe",
    "style.french": "Frans",
    "style.japanese": "Japans hout",
    "style.wabi": "Wabi-sabi",
    "style.american": "Amerikaans",
    "style.coastal": "Kuststijl",
    "style.vintage": "Midcentury",

    // Color chips
    "color.offWhite": "Gebroken wit",
    "color.cream": "Crème",
    "color.lightGray": "Lichtgrijs",
    "color.darkGray": "Donkergrijs",
    "color.khaki": "Khaki",
    "color.camel": "Kameel",
    "color.fogBlue": "Mistblauw",
    "color.darkGreen": "Donkergroen",
    "color.beanPink": "Oudroze",
    "color.terracotta": "Terracotta",

    // — Step 2: Select —
    "select.step": "STAP 2 / 3",
    "select.titleAI": "AI-aanbeveling",
    "select.titleManual": "Kies een stof",
    "select.subtitleAI": "AI analyseert uw kamer en adviseert de beste stof en stijl. U kunt ook handmatig wijzigen",
    "select.subtitleManual": "Klik op een stofkaart om te selecteren; wij tonen het als gordijn in uw kamer",
    "select.aiLoading": "AI analyseert uw ruimte...",
    "select.aiLoadingHint": "Kamerstijl, raamtype en lichtinval worden herkend voor de beste match",
    "select.cancel": "Annuleren",
    "select.aiFailed": "AI-aanbeveling mislukt",
    "select.aiFailedHint": ", u kunt zelf stof en stijl kiezen",
    "select.aiLabel": "AI-aanbeveling",
    "select.overridden": "Handmatig gewijzigd",
    "select.restore": "AI-keuze herstellen",
    "select.sceneAnalysis": "Ruimteanalyse: ",
    "select.fabricTag": "Stof",
    "select.styleTag": "Stijl",
    "select.notSatisfied": "Niet tevreden? Kies hieronder een andere stof en stijl",
    "select.chooseStyle": "Kies model",
    "select.clickToChange": "Klik om te wijzigen",
    "select.stylePrefix": "Stijl: ",
    "select.colorPrefix": "Kleur: ",
    "select.loadingFabrics": "Stoffen laden...",
    "select.noFabrics": "Geen stofgegevens",
    "select.addFabrics": "Voeg stoffen toe in het beheerderspaneel",
    "select.noImage": "Geen afbeelding",
    "select.noImageShort": "n.v.t.",
    "select.aiPick": "AI-keuze",
    "select.recommended": "Aanbevolen",
    "select.btnBack": "Terug",
    "select.btnGenerate": "Genereer voorbeeld",

    // — Step 3: Result —
    "result.step": "STAP 3 / 3",
    "result.generating": "Voorbeeld wordt gegenereerd...",
    "result.done": "Voorbeeld gereed",
    "result.failed": "Genereren mislukt",
    "result.fabricLabel": "Stof: ",
    "result.generatingHint": "AI genereert uw gordijnvoorbeeld, circa 30-60 seconden...",
    "result.retry": "Opnieuw",
    "result.videoTitle": "Video van bewegende gordijnen",
    "result.videoBtn": "Genereer video",
    "result.videoGenerating": "Video wordt gegenereerd, circa 1-2 minuten...",
    "result.changeFabric": "Andere stof",
    "result.restart": "Opnieuw beginnen",
    "result.downloadImage": "Afbeelding downloaden",
    "result.downloadVideo": "Video downloaden",

    // — Step Style —
    "stepStyle.step": "STAP 2 / 4",
    "stepStyle.title": "Kies gordijnmodel",
    "stepStyle.subtitle": "Elk model past bij andere ramen en ruimtes",
    "stepStyle.loading": "Modellen laden...",
    "stepStyle.empty": "Geen gordijnmodellen",
    "stepStyle.addHint": "Voeg modellen toe in het beheerderspaneel",
    "stepStyle.noImage": "n.v.t.",
    "stepStyle.btnBack": "Terug",
    "stepStyle.btnNext": "Volgende: kies stof",

    // — Errors —
    "error.compress": "Comprimeren mislukt",
    "error.imageLoad": "Afbeelding laden mislukt",
    "error.network": "Netwerkverzoek mislukt",
  },
  fr: {
    // — Header / Nav —
    "nav.step1": "Télécharger la scène",
    "nav.step2": "Choisir le tissu",
    "nav.step3": "Voir le résultat",
    "nav.admin": "Admin",
    "nav.footer": "Curtain Studio · Aperçu de rideaux par IA",

    // — Step 1: Scene —
    "scene.step": "ÉTAPE 1 / 3",
    "scene.title": "Téléchargez votre pièce et indiquez vos goûts",
    "scene.subtitle": "Téléchargez une photo de la pièce, choisissez style et couleur, ou laissez l'IA vous conseiller",
    "scene.uploadTitle": "Prenez ou téléchargez une photo de la pièce",
    "scene.uploadHint": "Meilleur résultat quand la fenêtre est entièrement visible",
    "scene.preview": "Aperçu de la scène",
    "scene.changeImage": "Changer",
    "scene.styleLabel": "Style préféré",
    "scene.optional": "Optionnel, cliquez pour sélectionner",
    "scene.colorLabel": "Couleur souhaitée",
    "scene.extraLabel": "Précisions",
    "scene.extraPlaceholder": "ex. un voilage au tombé naturel, pas trop épais, pour un salon style crème...",
    "scene.btnManual": "Choisir un tissu",
    "scene.btnAI": "Recommandation IA",

    // Style chips
    "style.modern": "Moderne minimaliste",
    "style.cream": "Style crème",
    "style.nordic": "Nordique",
    "style.luxury": "Luxe discret",
    "style.french": "Français",
    "style.japanese": "Bois japonais",
    "style.wabi": "Wabi-sabi",
    "style.american": "Américain",
    "style.coastal": "Style côtier",
    "style.vintage": "Mid-century",

    // Color chips
    "color.offWhite": "Blanc cassé",
    "color.cream": "Crème",
    "color.lightGray": "Gris clair",
    "color.darkGray": "Gris foncé",
    "color.khaki": "Kaki",
    "color.camel": "Camel",
    "color.fogBlue": "Bleu brume",
    "color.darkGreen": "Vert foncé",
    "color.beanPink": "Rose poudré",
    "color.terracotta": "Terracotta",

    // — Step 2: Select —
    "select.step": "ÉTAPE 2 / 3",
    "select.titleAI": "Recommandation IA",
    "select.titleManual": "Choisissez un tissu",
    "select.subtitleAI": "L'IA analyse votre pièce pour conseiller le meilleur tissu et modèle. Vous pouvez aussi modifier manuellement",
    "select.subtitleManual": "Cliquez sur une fiche tissu pour la sélectionner ; nous l'intégrerons en rideaux dans votre pièce",
    "select.aiLoading": "L'IA analyse votre pièce...",
    "select.aiLoadingHint": "Style de la pièce, type de fenêtre et lumière sont analysés pour la meilleure correspondance",
    "select.cancel": "Annuler",
    "select.aiFailed": "Échec de la recommandation IA",
    "select.aiFailedHint": ", vous pouvez choisir tissu et modèle manuellement",
    "select.aiLabel": "Recommandation IA",
    "select.overridden": "Modifié manuellement",
    "select.restore": "Restaurer le choix IA",
    "select.sceneAnalysis": "Analyse de la pièce : ",
    "select.fabricTag": "Tissu",
    "select.styleTag": "Modèle",
    "select.notSatisfied": "Pas satisfait ? Choisissez un autre tissu et modèle ci-dessous",
    "select.chooseStyle": "Choisir le modèle",
    "select.clickToChange": "Cliquez pour changer",
    "select.stylePrefix": "Style : ",
    "select.colorPrefix": "Couleur : ",
    "select.loadingFabrics": "Chargement des tissus...",
    "select.noFabrics": "Aucun tissu",
    "select.addFabrics": "Ajoutez des tissus dans le panneau d'administration",
    "select.noImage": "Aucune image",
    "select.noImageShort": "N/A",
    "select.aiPick": "Choix IA",
    "select.recommended": "Recommandé",
    "select.btnBack": "Retour",
    "select.btnGenerate": "Générer l'aperçu",

    // — Step 3: Result —
    "result.step": "ÉTAPE 3 / 3",
    "result.generating": "Génération de l'aperçu...",
    "result.done": "Aperçu prêt",
    "result.failed": "Échec de la génération",
    "result.fabricLabel": "Tissu : ",
    "result.generatingHint": "L'IA génère votre aperçu de rideaux, environ 30-60 secondes...",
    "result.retry": "Réessayer",
    "result.videoTitle": "Vidéo des rideaux en mouvement",
    "result.videoBtn": "Générer la vidéo",
    "result.videoGenerating": "Génération de la vidéo, environ 1-2 minutes...",
    "result.changeFabric": "Changer de tissu",
    "result.restart": "Recommencer",
    "result.downloadImage": "Télécharger l'image",
    "result.downloadVideo": "Télécharger la vidéo",

    // — Step Style —
    "stepStyle.step": "ÉTAPE 2 / 4",
    "stepStyle.title": "Choisissez le modèle de rideau",
    "stepStyle.subtitle": "Chaque modèle convient à des fenêtres et des espaces différents",
    "stepStyle.loading": "Chargement des modèles...",
    "stepStyle.empty": "Aucun modèle de rideau",
    "stepStyle.addHint": "Ajoutez des modèles dans le panneau d'administration",
    "stepStyle.noImage": "N/A",
    "stepStyle.btnBack": "Retour",
    "stepStyle.btnNext": "Suivant : choisir le tissu",

    // — Errors —
    "error.compress": "Échec de la compression",
    "error.imageLoad": "Échec du chargement de l'image",
    "error.network": "Échec de la requête réseau",
  },
};

const I18nContext = createContext<I18nCtx>({
  locale: "zh",
  setLocale: () => {},
  t: (k) => k,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("zh");
  const localeRef = useRef<Locale>("zh");
  const originalTextRef = useRef(new WeakMap<Node, string>());
  const originalAttributesRef = useRef(new WeakMap<Element, Map<string, string>>());

  useEffect(() => {
    const saved = localStorage.getItem("lang") as Locale | null;
    if (saved && LOCALES.includes(saved)) {
      localeRef.current = saved;
      setLocaleState(saved);
    }
  }, []);

  const setLocale = useCallback((l: Locale) => {
    localeRef.current = l;
    setLocaleState(l);
    localStorage.setItem("lang", l);
    document.documentElement.lang = HTML_LANG[l];
    document.documentElement.dataset.locale = l;
  }, []);

  useEffect(() => {
    localeRef.current = locale;
    document.documentElement.lang = HTML_LANG[locale];
    document.documentElement.dataset.locale = locale;

    const originalText = originalTextRef.current;
    const originalAttributes = originalAttributesRef.current;
    const attributes = ["aria-label", "placeholder", "title", "alt"];

    const translateNode = (root: Node, targetLocale: Locale) => {
      const nodes: Node[] = [];
      if (root.nodeType === Node.TEXT_NODE) nodes.push(root);
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) nodes.push(walker.currentNode);

      for (const node of nodes) {
        const parent = node.parentElement;
        if (!parent || parent.closest("[data-no-translate], script, style")) continue;
        if (targetLocale === "zh") {
          const source = originalText.get(node);
          if (source !== undefined) node.nodeValue = source;
          continue;
        }

        const current = node.nodeValue || "";
        const recorded = originalText.get(node);
        /**
         * 一律从**中文原文**出发翻译，不要拿屏幕上当前那句去查表。
         *
         * 翻译表的键全是中文。切过一次英文之后，DOM 里已经是 "Welcome back"，
         * 再切荷兰语时拿这个英文去查荷兰语表永远查不到，于是原地不动——
         * 表现就是"中英能切，切荷兰语法语没反应"。原先只有切回中文那条分支
         * 会用 originalText 还原，外语→外语这条路径漏了。
         */
        const source = recorded !== undefined ? recorded : current;
        const translated = translateRoyalZenText(source, targetLocale);
        if (translated === current) continue;
        // 第一次翻译这个节点时才记原文；已经记过的不能用译文覆盖掉
        if (recorded === undefined) originalText.set(node, current);
        node.nodeValue = translated;
      }

      const elements = root instanceof Element ? [root, ...Array.from(root.querySelectorAll("*"))] : [];
      for (const element of elements) {
        if (element.closest("[data-no-translate]")) continue;
        let saved = originalAttributes.get(element);
        for (const attribute of attributes) {
          const current = element.getAttribute(attribute);
          if (current === null) continue;
          if (targetLocale === "zh") {
            const source = saved?.get(attribute);
            if (source !== undefined) element.setAttribute(attribute, source);
            continue;
          }
          // 同上：aria-label / placeholder / title / alt 也要从中文原文翻，
          // 否则切过英文之后这些属性同样卡在英文
          const recorded = saved?.get(attribute);
          const source = recorded !== undefined ? recorded : current;
          const translated = translateRoyalZenText(source, targetLocale);
          if (translated === current) continue;
          if (recorded === undefined) {
            if (!saved) {
              saved = new Map();
              originalAttributes.set(element, saved);
            }
            saved.set(attribute, current);
          }
          element.setAttribute(attribute, translated);
        }
      }
    };

    translateNode(document.body, locale);
    const observer = new MutationObserver((mutations) => {
      // 原先写死 "en"：切到荷/法时新渲染出来的节点根本不进翻译，
      // 页面于是一半外文一半中文
      const active = localeRef.current;
      if (active === "zh") return;
      for (const mutation of mutations) {
        if (mutation.type === "characterData") translateNode(mutation.target, active);
        for (const node of Array.from(mutation.addedNodes)) translateNode(node, active);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [locale]);

  // 回落链：所选语言 → 英文 → 中文 → 键名本身。少一环就会在荷/法下抛 undefined
  const t = useCallback(
    (key: string) => dict[locale]?.[key] ?? dict.en?.[key] ?? dict.zh?.[key] ?? key,
    [locale]
  );

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useLocale() {
  const { locale, setLocale } = useContext(I18nContext);
  return { locale, setLocale };
}

export function useT() {
  return useContext(I18nContext).t;
}
