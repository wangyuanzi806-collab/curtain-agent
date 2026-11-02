/**
 * 语音顾问界面的四语言词条。
 *
 * **为什么单独一个文件，而不是并进 royalzen-translations.ts**：那份表正在被
 * 主线大改（四语言对齐，一千多行）。语音端再往同一个文件里塞词条，两边一合就打架，
 * 而打架的是翻译表——冲突解错了不会报错，只会让某种语言少几句话，没人看得出来。
 *
 * 接进主表只需要在 `translateRoyalZenText` 里加一行（见本文件末尾的说明）。
 *
 * **口径跟着话术走**：荷兰语一律 u（不用 je），法语一律 vous。
 * 门店顾客是陌生人，而这两种语言里称呼选错了，比语法错更刺耳。
 */

type Table = Record<string, string>;

/** 顾客/店员在屏幕上会看到的每一句。key 是中文原文，跟主表一个规矩。 */
const EN: Table = {
  "照片仅在当前页面预览，未上传、保存或交给 AI 分析；刷新后清除。": "Photo preview only. It is not uploaded, saved or sent to AI; refreshing clears it.",
  "房间照片本地预览，未上传": "Local room photo preview, not uploaded",
  "仅本地预览 · 尚未上传": "Local preview only · Not uploaded",
  "正在读取…": "Reading…",
  "仅本页预览 · 不上传、不保存": "Preview on this page only · Not uploaded or saved",

  // — 连接状态。建连要十几秒，这十几秒屏幕上一直在换字 —
  "待机": "Standby",
  "通话中": "Connected",
  "正在听": "Listening",
  "出错了": "Something went wrong",
  "正在重连…": "Reconnecting…",
  "正在接通…": "Connecting…",
  "正在取凭证…": "Getting access…",
  "正在接通音频…": "Connecting audio…",
  "等你允许麦克风…": "Waiting for microphone permission…",
  "正在向浏览器要麦克风…": "Requesting the microphone…",
  "麦克风好了 — 点球开始": "Microphone ready — tap the orb to start",
  "接不通，点一下再试": "Cannot connect — tap to retry",

  // — 故障。每一条都要说清下一步按哪里，"失败了"三个字帮不了店员 —
  "麦克风被拒绝了 — 点下面按钮重新请求": "Microphone denied — tap below to ask again",
  "麦克风被挡住了 — 请允许访问": "Microphone blocked — please allow access",
  "麦克风没有回应 — 请允许访问": "Microphone not responding — please allow access",
  "手机系统没有把麦克风交给浏览器": "Your phone is blocking microphone access for the browser",
  "网站麦克风权限已关闭": "Microphone access is off for this website",
  "浏览器没有交出麦克风": "The browser did not provide microphone access",
  "这台设备上找不到麦克风": "No microphone found on this device",
  "麦克风被别的程序占着 — 关掉它再试": "Another app is using the microphone — close it and retry",
  "没弹框就被拒了 — 按下面两处设置查": "Denied without a prompt — check the two settings below",
  "登录过期了 — 刷新页面重新登录": "Session expired — refresh and sign in again",
  "没拿到凭证": "No access token received",

  // — 工具回执 —
  "正在为这个房间选五款…": "Picking five for this room…",
  "已存下房间照片": "Room photo saved",
  "照片没传上去 — 再试一次": "The photo did not upload — try again",
  "还没有这一场的咨询单 — 先拍一张房间照片": "No consultation yet — take a room photo first",
  "效果图没出来 — 再点一次试试": "The preview did not come through — tap again",
  "⚠ 没能翻译": "⚠ Translation failed",
  "翻译中…": "Translating…",

  // — 会话流 —
  "问问这个房间适合什么": "Ask what suits this room",
  "问问这个房间": "Ask about this room",
  "这个房间的照片": "Photo of this room",
  "装在这个房间": "In this room",
  "拍一张，看装在您家什么样": "Take a photo to see it in your home",

  // — 底部操作条 —
  "打字告诉它…": "Type it instead…",
  "打字告诉它": "Type instead",
  "打字发给助手": "Type to the assistant",
  "收起打字": "Hide the keyboard",
  "加一张房间照片": "Add a room photo",
  "换一张房间照片": "Replace the room photo",
  "扫一下，从您手机传张照片": "Scan this to send a photo from your phone",
  "收起": "Hide",
  "已存下": "Saved",
  "正在存…": "Saving…",
  "选了会更准": "Makes the match better",
  "点一下开始说话": "Tap to start talking",
  "点一下结束": "Tap to end",
  "点一下，接着和顾客说": "Tap to carry on with the client",
  "点一下，让它听顾客说": "Tap to let it listen to the client",
  "换一个模型试试（会重新接通一次）": "Try another model (reconnects)",
  "停止": "Stop",
  "开始": "Start",

  // — 接待记录 —
  "↩ 继续刚才": "↩ Resume",
  "有房间照片": "Has a room photo",
  "＋ 下一位顾客": "＋ Next client",
  "近期接待": "Recent sessions",
  "关闭": "Close",
  "还没有记录。这台手机上聊过的每一场都会出现在这里。":
    "No sessions yet. Every conversation held on this phone will appear here.",
  "（没说话）": "(nothing said)",

  // — 面料质感。工具枚举是给模型读的，这三个是给人读的 —
  "发送": "Send",
  "重新请求麦克风": "Ask for the microphone again",
  "没弹出询问时，请在手机系统里允许 Chrome 使用麦克风，再到 Chrome 的网站设置中允许":
    "If no prompt appeared, allow Chrome to use the microphone in your phone settings, then allow",
  "。改好后刷新页面重试。": " in Chrome's site settings. Refresh the page once done.",
  "顾客说什么语言，它就用什么语言答。": "It answers in whatever language the customer speaks.",
  "比如「客厅朝南，想要遮光一点的」":
    "For example: “the living room faces south, we want something that blocks the light”",
  "点下面的按钮开始说话。": "Tap the button below to start talking.",

  "法语会变成荷兰语，荷兰语会变成法语。":
    "French becomes Dutch, Dutch becomes French.",
  "麦克风已开启": "Microphone is on",
  "麦克风权限已关闭 — 点下面的浏览器授权按钮":
    "Microphone permission is off — use the browser button below",
  "麦克风正被别的程序使用": "Another app is using the microphone",
  "请在浏览器提示中开启麦克风": "Allow the microphone in the browser prompt",
  "尚未开启麦克风 — 点按钮重试": "Microphone not on yet — tap the button to retry",
  "开启麦克风并开始通话": "Turn on the microphone and start",

  "网站和桌面快捷方式使用同一份权限；点一下，由浏览器完成授权。":
    "The website and the home-screen shortcut share one permission. Tap once and the browser handles it.",
  "网站权限已经允许，但手机系统仍拦着。请开启手机的“麦克风访问”，并在应用权限里允许 Chrome；回来后再点上面按钮。":
    "The website is allowed, but your phone is still blocking the microphone. Turn on Microphone access and allow Chrome in app permissions, then return and tap the button above.",
  "请在地址栏旁的网站设置里把麦克风改为允许；回来后再点上面按钮。":
    "Open the site settings beside the address bar, allow the microphone, then return and tap the button above.",
  "素净": "Plain",
  "细肌理": "Fine texture",
  "有花纹": "Patterned"
};

const NL: Table = {
  "照片仅在当前页面预览，未上传、保存或交给 AI 分析；刷新后清除。": "Alleen een fotovoorbeeld. Niet geüpload, opgeslagen of naar AI gestuurd; vernieuwen wist het.",
  "房间照片本地预览，未上传": "Lokaal voorbeeld van de kamerfoto, niet geüpload",
  "仅本地预览 · 尚未上传": "Alleen lokaal voorbeeld · Niet geüpload",
  "正在读取…": "Bezig met lezen…",
  "仅本页预览 · 不上传、不保存": "Alleen op deze pagina · Niet geüpload of opgeslagen",

  "待机": "Stand-by",
  "通话中": "Verbonden",
  "正在听": "Luistert",
  "出错了": "Er is iets misgegaan",
  "正在重连…": "Opnieuw verbinden…",
  "正在接通…": "Verbinden…",
  "正在取凭证…": "Toegang ophalen…",
  "正在接通音频…": "Audio verbinden…",
  "等你允许麦克风…": "Wachten op toestemming voor de microfoon…",
  "正在向浏览器要麦克风…": "Microfoon aanvragen…",
  "麦克风好了 — 点球开始": "Microfoon klaar — tik op de bol om te beginnen",
  "接不通，点一下再试": "Geen verbinding — tik om opnieuw te proberen",

  "麦克风被拒绝了 — 点下面按钮重新请求": "Microfoon geweigerd — tik hieronder om opnieuw te vragen",
  "麦克风被挡住了 — 请允许访问": "Microfoon geblokkeerd — geef toegang",
  "麦克风没有回应 — 请允许访问": "Microfoon reageert niet — geef toegang",
  "手机系统没有把麦克风交给浏览器": "Uw telefoon blokkeert de microfoon voor de browser",
  "网站麦克风权限已关闭": "Microfoontoegang staat uit voor deze website",
  "浏览器没有交出麦克风": "De browser gaf geen toegang tot de microfoon",
  "这台设备上找不到麦克风": "Geen microfoon gevonden op dit apparaat",
  "麦克风被别的程序占着 — 关掉它再试": "Een andere app gebruikt de microfoon — sluit die en probeer opnieuw",
  "没弹框就被拒了 — 按下面两处设置查": "Geweigerd zonder venster — controleer de twee instellingen hieronder",
  "登录过期了 — 刷新页面重新登录": "Sessie verlopen — vernieuw de pagina en meld u opnieuw aan",
  "没拿到凭证": "Geen toegangsbewijs ontvangen",

  "正在为这个房间选五款…": "Vijf stoffen kiezen voor deze kamer…",
  "已存下房间照片": "Kamerfoto opgeslagen",
  "照片没传上去 — 再试一次": "De foto is niet geüpload — probeer opnieuw",
  "还没有这一场的咨询单 — 先拍一张房间照片": "Nog geen consultatie — maak eerst een kamerfoto",
  "效果图没出来 — 再点一次试试": "De visualisatie is niet gelukt — tik nogmaals",
  "⚠ 没能翻译": "⚠ Vertaling mislukt",
  "翻译中…": "Vertalen…",

  "问问这个房间适合什么": "Vraag wat bij deze kamer past",
  "问问这个房间": "Over deze kamer",
  "这个房间的照片": "Foto van deze kamer",
  "装在这个房间": "In deze kamer",
  "拍一张，看装在您家什么样": "Maak een foto en zie het bij u thuis",

  "打字告诉它…": "Typ het hier…",
  "打字告诉它": "Typen",
  "打字发给助手": "Typ naar de assistent",
  "收起打字": "Toetsenbord verbergen",
  "加一张房间照片": "Kamerfoto toevoegen",
  "换一张房间照片": "Kamerfoto vervangen",
  "扫一下，从您手机传张照片": "Scan dit en stuur een foto vanaf uw telefoon",
  "收起": "Verbergen",
  "已存下": "Opgeslagen",
  "正在存…": "Opslaan…",
  "选了会更准": "Maakt het advies preciezer",
  "点一下开始说话": "Tik om te beginnen met praten",
  "点一下结束": "Tik om te stoppen",
  "点一下，接着和顾客说": "Tik om verder te gaan met de klant",
  "点一下，让它听顾客说": "Tik zodat het naar de klant luistert",
  "换一个模型试试（会重新接通一次）": "Een ander model proberen (maakt opnieuw verbinding)",
  "停止": "Stoppen",
  "开始": "Starten",

  "↩ 继续刚才": "↩ Hervatten",
  "有房间照片": "Met kamerfoto",
  "＋ 下一位顾客": "＋ Volgende klant",
  "近期接待": "Recente gesprekken",
  "关闭": "Sluiten",
  "还没有记录。这台手机上聊过的每一场都会出现在这里。":
    "Nog geen gesprekken. Elk gesprek op deze telefoon verschijnt hier.",
  "（没说话）": "(niets gezegd)",

  "发送": "Versturen",
  "重新请求麦克风": "Microfoon opnieuw aanvragen",
  "没弹出询问时，请在手机系统里允许 Chrome 使用麦克风，再到 Chrome 的网站设置中允许":
    "Verscheen er geen venster, geef Chrome dan toegang tot de microfoon in de instellingen van uw telefoon en sta daarna",
  "。改好后刷新页面重试。":
    " toe bij de site-instellingen van Chrome. Vernieuw daarna de pagina.",
  "顾客说什么语言，它就用什么语言答。": "Het antwoordt in de taal die de klant spreekt.",
  "比如「客厅朝南，想要遮光一点的」":
    "Bijvoorbeeld: “de woonkamer ligt op het zuiden, we willen iets dat het licht tegenhoudt”",
  "点下面的按钮开始说话。": "Tik op de knop hieronder om te beginnen met praten.",

  "法语会变成荷兰语，荷兰语会变成法语。":
    "Frans wordt Nederlands, Nederlands wordt Frans.",
  "麦克风已开启": "Microfoon staat aan",
  "麦克风权限已关闭 — 点下面的浏览器授权按钮":
    "Microfoontoegang staat uit — gebruik de browserknop hieronder",
  "麦克风正被别的程序使用": "Een andere app gebruikt de microfoon",
  "请在浏览器提示中开启麦克风": "Geef de microfoon vrij in het venster van de browser",
  "尚未开启麦克风 — 点按钮重试": "Microfoon staat nog niet aan — tik op de knop",
  "开启麦克风并开始通话": "Microfoon aanzetten en beginnen",

  "网站和桌面快捷方式使用同一份权限；点一下，由浏览器完成授权。":
    "De website en de snelkoppeling delen dezelfde toestemming. Tik één keer, de browser regelt de rest.",
  "网站权限已经允许，但手机系统仍拦着。请开启手机的“麦克风访问”，并在应用权限里允许 Chrome；回来后再点上面按钮。":
    "De website is toegestaan, maar uw telefoon blokkeert de microfoon nog. Zet Microfoontoegang aan en sta Chrome toe bij de app-machtigingen. Keer terug en tik op de knop hierboven.",
  "请在地址栏旁的网站设置里把麦克风改为允许；回来后再点上面按钮。":
    "Open de site-instellingen naast de adresbalk, sta de microfoon toe, keer terug en tik op de knop hierboven.",
  "素净": "Effen",
  "细肌理": "Fijne structuur",
  "有花纹": "Met dessin"
};

const FR: Table = {
  "照片仅在当前页面预览，未上传、保存或交给 AI 分析；刷新后清除。": "Aperçu uniquement. La photo n’est ni téléversée, ni enregistrée, ni envoyée à l’IA ; actualiser l’efface.",
  "房间照片本地预览，未上传": "Aperçu local de la pièce, photo non téléversée",
  "仅本地预览 · 尚未上传": "Aperçu local uniquement · Non téléversé",
  "正在读取…": "Lecture…",
  "仅本页预览 · 不上传、不保存": "Aperçu sur cette page uniquement · Ni téléversé ni enregistré",

  "待机": "En veille",
  "通话中": "Connecté",
  "正在听": "À l'écoute",
  "出错了": "Une erreur est survenue",
  "正在重连…": "Reconnexion…",
  "正在接通…": "Connexion…",
  "正在取凭证…": "Obtention de l'accès…",
  "正在接通音频…": "Connexion audio…",
  "等你允许麦克风…": "En attente de l'autorisation du micro…",
  "正在向浏览器要麦克风…": "Demande du micro…",
  "麦克风好了 — 点球开始": "Micro prêt — touchez la sphère pour commencer",
  "接不通，点一下再试": "Connexion impossible — touchez pour réessayer",

  "麦克风被拒绝了 — 点下面按钮重新请求": "Micro refusé — touchez ci-dessous pour redemander",
  "麦克风被挡住了 — 请允许访问": "Micro bloqué — autorisez l'accès",
  "麦克风没有回应 — 请允许访问": "Le micro ne répond pas — autorisez l'accès",
  "手机系统没有把麦克风交给浏览器": "Votre téléphone bloque l'accès du navigateur au micro",
  "网站麦克风权限已关闭": "L'accès au micro est désactivé pour ce site",
  "浏览器没有交出麦克风": "Le navigateur n'a pas donné accès au micro",
  "这台设备上找不到麦克风": "Aucun micro détecté sur cet appareil",
  "麦克风被别的程序占着 — 关掉它再试": "Une autre application utilise le micro — fermez-la et réessayez",
  "没弹框就被拒了 — 按下面两处设置查": "Refusé sans invite — vérifiez les deux réglages ci-dessous",
  "登录过期了 — 刷新页面重新登录": "Session expirée — actualisez la page et reconnectez-vous",
  "没拿到凭证": "Aucun identifiant reçu",

  "正在为这个房间选五款…": "Sélection de cinq tissus pour cette pièce…",
  "已存下房间照片": "Photo de la pièce enregistrée",
  "照片没传上去 — 再试一次": "La photo n'a pas été envoyée — réessayez",
  "还没有这一场的咨询单 — 先拍一张房间照片": "Pas encore de consultation — prenez d'abord une photo de la pièce",
  "效果图没出来 — 再点一次试试": "L'aperçu n'a pas abouti — touchez à nouveau",
  "⚠ 没能翻译": "⚠ Échec de la traduction",
  "翻译中…": "Traduction…",

  "问问这个房间适合什么": "Demander ce qui convient à cette pièce",
  "问问这个房间": "À propos de cette pièce",
  "这个房间的照片": "Photo de cette pièce",
  "装在这个房间": "Dans cette pièce",
  "拍一张，看装在您家什么样": "Prenez une photo pour le voir chez vous",

  "打字告诉它…": "Écrivez-le plutôt…",
  "打字告诉它": "Écrire",
  "打字发给助手": "Écrire à l'assistant",
  "收起打字": "Masquer le clavier",
  "加一张房间照片": "Ajouter une photo de la pièce",
  "换一张房间照片": "Remplacer la photo de la pièce",
  "扫一下，从您手机传张照片": "Scannez ceci pour envoyer une photo depuis votre téléphone",
  "收起": "Masquer",
  "已存下": "Enregistrée",
  "正在存…": "Enregistrement…",
  "选了会更准": "Affine la sélection",
  "点一下开始说话": "Touchez pour commencer à parler",
  "点一下结束": "Touchez pour terminer",
  "点一下，接着和顾客说": "Touchez pour poursuivre avec le client",
  "点一下，让它听顾客说": "Touchez pour qu'il écoute le client",
  "换一个模型试试（会重新接通一次）": "Essayer un autre modèle (nouvelle connexion)",
  "停止": "Arrêter",
  "开始": "Démarrer",

  "↩ 继续刚才": "↩ Reprendre",
  "有房间照片": "Avec photo de la pièce",
  "＋ 下一位顾客": "＋ Client suivant",
  "近期接待": "Sessions récentes",
  "关闭": "Fermer",
  "还没有记录。这台手机上聊过的每一场都会出现在这里。":
    "Aucune session. Chaque conversation menée sur ce téléphone apparaîtra ici.",
  "（没说话）": "(rien dit)",

  "发送": "Envoyer",
  "重新请求麦克风": "Redemander le micro",
  "没弹出询问时，请在手机系统里允许 Chrome 使用麦克风，再到 Chrome 的网站设置中允许":
    "Si aucune invite n'est apparue, autorisez Chrome à utiliser le micro dans les réglages du téléphone, puis autorisez",
  "。改好后刷新页面重试。":
    " dans les paramètres de site de Chrome. Actualisez ensuite la page.",
  "顾客说什么语言，它就用什么语言答。": "Il répond dans la langue que parle le client.",
  "比如「客厅朝南，想要遮光一点的」":
    "Par exemple : « le salon est exposé au sud, on veut quelque chose qui bloque la lumière »",
  "点下面的按钮开始说话。": "Touchez le bouton ci-dessous pour commencer à parler.",

  "法语会变成荷兰语，荷兰语会变成法语。":
    "Le français devient du néerlandais, le néerlandais devient du français.",
  "麦克风已开启": "Le micro est activé",
  "麦克风权限已关闭 — 点下面的浏览器授权按钮":
    "L'accès au micro est désactivé — utilisez le bouton du navigateur ci-dessous",
  "麦克风正被别的程序使用": "Une autre application utilise le micro",
  "请在浏览器提示中开启麦克风": "Autorisez le micro dans l'invite du navigateur",
  "尚未开启麦克风 — 点按钮重试": "Micro pas encore activé — touchez le bouton",
  "开启麦克风并开始通话": "Activer le micro et commencer",

  "网站和桌面快捷方式使用同一份权限；点一下，由浏览器完成授权。":
    "Le site et le raccourci partagent la même autorisation. Touchez une fois, le navigateur s'en charge.",
  "网站权限已经允许，但手机系统仍拦着。请开启手机的“麦克风访问”，并在应用权限里允许 Chrome；回来后再点上面按钮。":
    "Le site est autorisé, mais votre téléphone bloque encore le micro. Activez l'accès au micro et autorisez Chrome dans les permissions de l'application, puis revenez toucher le bouton ci-dessus.",
  "请在地址栏旁的网站设置里把麦克风改为允许；回来后再点上面按钮。":
    "Ouvrez les paramètres du site près de la barre d'adresse, autorisez le micro, puis revenez toucher le bouton ci-dessus.",
  "素净": "Uni",
  "细肌理": "Texture fine",
  "有花纹": "À motifs"
};

const TABLES: Record<string, Table> = { en: EN, nl: NL, fr: FR };

/**
 * 建连的每一步都有名字，出错时拼进状态条（「卡在取凭证」）。
 * 单独拿出来是因为它们从不独立出现在屏幕上，只作为变量嵌在别的句子里——
 * 精确匹配永远命中不了，得先把它们翻掉再拼。
 */
const STAGES: Record<string, Table> = {
  en: {
    "取凭证": "getting access",
    "等你允许麦克风": "microphone permission",
    "交换 SDP": "SDP exchange",
    "交换 SDP（经服务端）": "SDP exchange (via server)",
    "建立音频通道": "opening the audio channel",
    "接通": "connecting"
  },
  nl: {
    "取凭证": "toegang ophalen",
    "等你允许麦克风": "toestemming microfoon",
    "交换 SDP": "SDP-uitwisseling",
    "交换 SDP（经服务端）": "SDP-uitwisseling (via server)",
    "建立音频通道": "audiokanaal openen",
    "接通": "verbinden"
  },
  fr: {
    "取凭证": "obtention de l'accès",
    "等你允许麦克风": "autorisation du micro",
    "交换 SDP": "échange SDP",
    "交换 SDP（经服务端）": "échange SDP (via serveur)",
    "建立音频通道": "ouverture du canal audio",
    "接通": "connexion"
  }
};

/**
 * 拼出来的句子。
 *
 * 主表的动态翻译只出英文（那份表里每条规则都写死了英文返回值），
 * 语音端这边全是店员在故障时读的字——荷兰语界面上突然冒出中文，
 * 等于这条提示没写。所以这里的每条规则都要给足三种语言。
 */
type Rule = [RegExp, (locale: string, ...m: string[]) => string];

const pick = (locale: string, en: string, nl: string, fr: string) =>
  locale === "nl" ? nl : locale === "fr" ? fr : en;

const stage = (locale: string, value: string) => STAGES[locale]?.[value] ?? value;

const RULES: Rule[] = [
  [/^卡在(.+)$/, (l, _all, s) =>
    pick(l, `stuck at ${stage(l, s)}`, `vastgelopen bij ${stage(l, s)}`, `bloqué à ${stage(l, s)}`)],

  [/^接不通（(.+)）— 点一下重试$/, (l, _all, why) => {
    const w = /^卡在(.+)$/.exec(why);
    const inner = w
      ? pick(l, `stuck at ${stage(l, w[1])}`, `vastgelopen bij ${stage(l, w[1])}`, `bloqué à ${stage(l, w[1])}`)
      : why;
    return pick(
      l,
      `Cannot connect (${inner}) — tap to retry`,
      `Geen verbinding (${inner}) — tik om opnieuw te proberen`,
      `Connexion impossible (${inner}) — touchez pour réessayer`
    );
  }],

  [/^接不通：(.+)$/, (l, _all, msg) =>
    pick(l, `Cannot connect: ${msg}`, `Geen verbinding: ${msg}`, `Connexion impossible : ${msg}`)],

  [/^麦克风打不开（(.+)）$/, (l, _all, why) =>
    pick(l, `Microphone failed (${why})`, `Microfoon mislukt (${why})`, `Échec du micro (${why})`)],

  [/^凭证被拒（(.+)）— 刷新页面再试$/, (l, _all, detail) => {
    // detail 是「阶段名 HTTP 码」拼的（"取凭证 401"）。里头那半截也是中文，
    // 整段原样带过去，荷兰语界面上就会剩两个汉字杵在括号里。
    const split = /^(.+?)\s+(\S+)$/.exec(detail);
    const shown = split ? `${stage(l, split[1])} ${split[2]}` : stage(l, detail);
    return pick(
      l,
      `Access refused (${shown}) — refresh and try again`,
      `Toegang geweigerd (${shown}) — vernieuw de pagina en probeer opnieuw`,
      `Accès refusé (${shown}) — actualisez la page et réessayez`
    );
  }],

  [/^原因不明$/, (l) => pick(l, "reason unknown", "reden onbekend", "raison inconnue")],

  [/^查询 (.+)$/, (l, _all, tool) =>
    pick(l, `Looking up ${tool}`, `${tool} opzoeken`, `Recherche de ${tool}`)],

  [/^已存下房间照片 · 墙面 (.+)$/, (l, _all, wall) =>
    pick(l, `Room photo saved · wall ${wall}`, `Kamerfoto opgeslagen · muur ${wall}`,
      `Photo enregistrée · mur ${wall}`)],

  [/^正在把(.+)装进这个房间…$/, (l, _all, colour) =>
    pick(l, `Fitting ${colour} into this room…`, `${colour} in deze kamer plaatsen…`,
      `Installation de ${colour} dans cette pièce…`)],

  [/^正在合成(.*)… 约半分钟$/, (l, _all, colour) => {
    const what = colour.trim();
    return pick(
      l,
      `Rendering ${what || "the preview"}… about half a minute`,
      `${what || "De visualisatie"} maken… ongeveer een halve minuut`,
      `Génération de ${what || "l'aperçu"}… environ trente secondes`
    );
  }],

  [/^看(.+)装在您家什么样$/, (l, _all, colour) =>
    pick(l, `See ${colour} in your home`, `Zie ${colour} bij u thuis`, `Voir ${colour} chez vous`)],

  [/^(.+) · 装在这个房间$/, (l, _all, colour) =>
    pick(l, `${colour} · in this room`, `${colour} · in deze kamer`, `${colour} · dans cette pièce`)],

  [/^(.+)装在这个房间的样子$/, (l, _all, colour) =>
    pick(l, `${colour} shown in this room`, `${colour} in deze kamer`, `${colour} dans cette pièce`)],

  [/^这一款$/, (l) => pick(l, "this one", "deze", "celui-ci")],

  // 两处都在用：接待记录里带个中点前缀（「· 已推 5 款」），恢复条上不带
  [/^(·\s*)?已推 (\d+) 款$/, (l, _all, dot, n) =>
    `${dot ?? ""}${pick(l, `${n} picked`, `${n} gekozen`, `${n} sélectionnés`)}`]
];

/**
 * 语音端界面文字的翻译入口。
 *
 * 返回 null 表示「这句不是语音端的」，调用方继续走主表——
 * **不要在这里回落成中文原文**，那会把主表的机会吃掉。
 */
export function translateVoiceText(text: string, locale: string): string | null {
  if (locale === "zh") return null;
  const exact = TABLES[locale]?.[text];
  if (exact) return exact;
  for (const [pattern, replace] of RULES) {
    const m = pattern.exec(text);
    if (m) return replace(locale, ...m);
  }
  // 目标语言缺词条时回落英文：对着荷兰客户，英文界面尚可用，中文界面等于没有界面
  return TABLES[locale] ? EN[text] ?? null : null;
}

/*
 * 已经接进 `royalzen-translations.ts` 的 `translateRoyalZenText`：
 * 那边的查表顺序是「主表目标语言 → 这里 → 主表英文兜底」。
 * 以后语音端加界面文字，只改本文件，不必再动主表。
 */
