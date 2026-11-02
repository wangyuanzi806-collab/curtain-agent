import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * 让顾客用自己的手机把照片传进来。
 *
 * 要解决的事很具体:顾客的房间照片在**他自己手机里**,而店里那台在顾问手上。
 * 现在无解——只能加微信,太重。而顾客手机里那张往往还更好:白天拍的、多角度、
 * 家具都在。
 *
 * ## 这枚 token 的边界
 *
 * 拿到它的人**只能往这一条咨询单上传一张照片**,别的什么都做不了:
 * 看不到咨询单的任何内容、看不到顾客姓名、也换不到别的咨询单。
 * 上传页只有一个按钮,token 本身就是全部凭证——顾客不登录、不装 App。
 *
 * · 10 分钟过期。顾客当场扫,不需要更久;而一张躺在浏览器历史里的旧码
 *   就是一个还开着的口子
 * · 一次性。nonce 记在咨询单上,传成功就清掉,同一枚码传不了第二次
 * · 签名不可伪造。改一个字符签名就对不上,而 consultationId 是签在里面的,
 *   换成别人的单子等于换了 payload
 *
 * ## 为什么不新建一张表
 *
 * token 不落库,状态只有一个 nonce,搭在咨询单的 preferences 里就够了。
 * 为一枚活十分钟的凭证加一张表、一次 migration、一条清理任务,不划算。
 */

/**
 * 签名密钥从 service role key 派生,不新增配置项。
 *
 * 派生而不是直接用:万一签名算法哪天泄漏了中间值,拿到的也不是那把钥匙本身。
 * 轮换 service role key 会让在途的 token 全部失效——有效期只有十分钟,无所谓。
 */
function secret(): Buffer {
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!base) throw new Error("missing_upload_secret");
  return createHash("sha256").update(`${base}:voice-photo-upload`).digest();
}

const TTL_MS = 10 * 60 * 1000;

export type UploadClaims = {
  consultationId: string;
  organizationId: string;
  nonce: string;
  exp: number;
};

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/** 签一枚。nonce 要同时写进咨询单,否则这枚 token 验不过 */
export function issueUploadToken(consultationId: string, organizationId: string) {
  const nonce = randomBytes(12).toString("base64url");
  const claims: UploadClaims = {
    consultationId,
    organizationId,
    nonce,
    exp: Date.now() + TTL_MS
  };
  const payload = b64url(JSON.stringify(claims));
  return { token: `${payload}.${sign(payload)}`, nonce, expiresAt: claims.exp };
}

/**
 * 验一枚。**先验签再看内容**——没验签之前 payload 里的每个字都是攻击者写的。
 *
 * 比签名用 timingSafeEqual:普通的 === 会在第一个不同的字节处返回,
 * 逐字节试探就能把签名磨出来。这条路是**免登录**的,没有别的门挡在前面。
 */
export function readUploadToken(token: string): UploadClaims | null {
  const [payload, mac] = String(token ?? "").split(".");
  if (!payload || !mac) return null;

  let expected: Buffer;
  let given: Buffer;
  try {
    expected = Buffer.from(sign(payload), "base64url");
    given = Buffer.from(mac, "base64url");
  } catch {
    return null;
  }
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as UploadClaims;
    if (!claims?.consultationId || !claims?.organizationId || !claims?.nonce) return null;
    if (!Number.isFinite(claims.exp) || claims.exp < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}
