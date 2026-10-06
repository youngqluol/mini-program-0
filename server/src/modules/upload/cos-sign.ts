/**
 * 腾讯云 COS 请求签名（`Authorization` 头）—— **纯函数，零依赖**。
 *
 * 为什么自己实现而不引 `cos-nodejs-sdk-v5`：
 *   我们只用到一个动作（`PUT Object`），SDK 会带进十几个传递依赖。
 *   签名本身是 HMAC-SHA1 + SHA1 的固定四步，`node:crypto` 就够
 *   （与「COS 上传不需要 SDK」这条判断一致，见 docs/01 §六）。
 *
 * ⚠️ **这个文件是全项目最容易「静默写错」的地方** ——
 *    签名错了 COS 只回一句 `SignatureDoesNotMatch`，不告诉你哪一步错了。
 *    所以它被刻意拆成纯函数，并由 `server/scripts/check-cos-sign.ts`
 *    拿**官方文档的完整示例**逐项比对（`pnpm run check:cos-sign`）。
 *    改这个文件之前先跑那个脚本。
 *
 * 算法（腾讯云 COS 文档「请求签名」）：
 *
 *   KeyTime     = `${起始时间戳};${过期时间戳}`        （Unix 秒）
 *   SignKey     = HMAC-SHA1(SecretKey, KeyTime)        → hex
 *   HttpString  = `${method}\n${pathname}\n${params}\n${headers}\n`
 *   StringToSign= `sha1\n${KeyTime}\n${SHA1(HttpString)}\n`
 *   Signature   = HMAC-SHA1(SignKey, StringToSign)     → hex
 *
 *   Authorization = q-sign-algorithm=sha1
 *                 & q-ak=<SecretId>
 *                 & q-sign-time=<KeyTime>
 *                 & q-key-time=<KeyTime>
 *                 & q-header-list=<参与签名的头，小写、字典序、分号连接>
 *                 & q-url-param-list=<参与签名的参数，同上>
 *                 & q-signature=<Signature>
 *
 * 三个容易踩的细节：
 *   ① **参与签名的头可以只挑一部分**（官方原文：「不需要处理全部头部，
 *      用户可按需筛选」）。本项目只签 `host` —— 签的越少，能写错的地方越少。
 *   ② 头与参数的值要 **UrlEncode**，键要**转小写**；列表本身用 `;` 连接，
 *      而 `HttpString` 里的键值对用 `&` 连接。两处分隔符不一样。
 *   ③ `HttpString` 里的路径是**解码后**的路径。官方示例的请求行写
 *      `/exampleobject(%E8%85%BE%E8%AE%AF%E4%BA%91)`，而 `HttpString` 里
 *      写的是 `/exampleobject(腾讯云)`。本项目的 key 全是 ASCII，不受影响，
 *      但传参时请传**未编码**的路径。
 */

import { createHash, createHmac } from 'node:crypto';

/** `buildCosAuthorization` 的入参 */
export interface CosSignParams {
  secretId: string;
  secretKey: string;
  /** HTTP 方法，大小写不敏感（内部会转小写） */
  method: string;
  /** 对象路径，**以 `/` 开头且未 URL 编码**，例如 `/memories/2026/10/abc.jpg` */
  pathname: string;
  /** 参与签名的请求头。键大小写不敏感（内部转小写），**至少要含 `host`** */
  headers: Record<string, string>;
  /** 参与签名的 URL 参数。本项目的上传没有参数，可以不传 */
  params?: Record<string, string>;
  /** 签名有效期（秒） */
  expiresIn: number;
  /** 签名起始时刻（Unix 秒）。默认取当前时间；**自检要钉住它** */
  now?: number;
}

/** 签名结果 —— 中间量一并返回，方便自检逐项比对 */
export interface CosSignature {
  /** 直接塞进 `Authorization` 请求头的完整字符串 */
  authorization: string;
  keyTime: string;
  signKey: string;
  httpString: string;
  stringToSign: string;
  signature: string;
}

/** 按 COS 的规则把一组键值对排成 `key=encodedValue&...`（键小写、字典序） */
function buildPairs(input: Record<string, string> | undefined): {
  keys: string[];
  list: string;
  pairs: string;
} {
  const normalized = new Map<string, string>();
  for (const [k, v] of Object.entries(input ?? {})) {
    normalized.set(k.toLowerCase(), v);
  }
  const keys = [...normalized.keys()].sort();
  return {
    keys,
    list: keys.join(';'),
    pairs: keys.map((k) => `${k}=${encodeURIComponent(normalized.get(k) as string)}`).join('&'),
  };
}

/** 构造 COS 请求签名。**纯函数**：同样的入参（含 `now`）永远得到同样的结果。 */
export function buildCosAuthorization(p: CosSignParams): CosSignature {
  const now = p.now ?? Math.floor(Date.now() / 1000);
  const keyTime = `${now};${now + p.expiresIn}`;

  const signKey = createHmac('sha1', p.secretKey).update(keyTime, 'utf8').digest('hex');

  const headers = buildPairs(p.headers);
  const params = buildPairs(p.params);

  // 注意结尾那个 \n：HttpString 的四段以 \n 分隔且**以 \n 收尾**
  const httpString =
    `${p.method.toLowerCase()}\n` + `${p.pathname}\n` + `${params.pairs}\n` + `${headers.pairs}\n`;

  const stringToSign =
    `sha1\n${keyTime}\n` + `${createHash('sha1').update(httpString, 'utf8').digest('hex')}\n`;

  const signature = createHmac('sha1', signKey).update(stringToSign, 'utf8').digest('hex');

  const authorization = [
    'q-sign-algorithm=sha1',
    `q-ak=${p.secretId}`,
    `q-sign-time=${keyTime}`,
    `q-key-time=${keyTime}`,
    `q-header-list=${headers.list}`,
    `q-url-param-list=${params.list}`,
    `q-signature=${signature}`,
  ].join('&');

  return { authorization, keyTime, signKey, httpString, stringToSign, signature };
}
