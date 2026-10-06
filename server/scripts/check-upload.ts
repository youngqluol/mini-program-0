/**
 * 上传链路自检 —— 覆盖两处**「没有凭证 / 没有真图就验不了」**的纯逻辑。
 *
 * ================================================================
 * 一、COS 请求签名
 * ================================================================
 *
 * 为什么需要它：
 *   签名错了 COS 只回一句 `SignatureDoesNotMatch`，**不告诉你哪一步错了**。
 *   而「哪一步错了」有十几个可能：头没转小写、值没 UrlEncode、
 *   列表用错分隔符（`;` vs `&`）、`HttpString` 少一个结尾 `\n`……
 *   全是**静默**的。更糟的是这条链路**没有凭证就跑不了** ——
 *   等真机上发现上传 403，排查成本远高于在这里花 5 分钟。
 *
 * 判据来源（腾讯云 COS 文档「请求签名」→ 示例一：上传对象）：
 *
 *   KeyTime          = 1557989151;1557996351
 *   SecretId         = AKIDQjz3ltompVjBni5LitkWHFlFpwpn
 *   SecretKey        = BQYIM75p8x0iWVFSIgqEKwFprpRSVHlz
 *   HttpString       = put\n/exampleobject(腾讯云)\n\n
 *                      content-length=13&content-md5=mQ%2FfVh815F3k6TAUm8m0eg%3D%3D&
 *                      content-type=text%2Fplain&date=Thu%2C%2016%20May%202019%2006%3A45%3A51%20GMT&
 *                      host=examplebucket-1250000000.cos.ap-beijing.myqcloud.com&
 *                      x-cos-acl=private&x-cos-grant-read=uin%3D%22100000000011%22\n
 *   SignKey          = eb2519b498b02ac213cb1f3d1a3d27a3b3c9bc5f
 *   SHA1(HttpString) = 8b2751e77f43a0995d6e9eb9477f4b685cca4172
 *   Signature        = 3b8851a11a569213c17ba8fa7dcf2abec6931234
 *
 * ⚠️ **文档里 `Signature` 的末 4 位被打码成了 `1234`**（示例二同样以
 *    `f6c01234` 结尾，两个示例不可能这么巧）。所以断言只比**前 28 位**，
 *    并单独把「末 4 位是打码」写在注释里 —— 免得后人以为算错了。
 *
 * ================================================================
 * 二、图片头解析
 * ================================================================
 *
 * 为什么需要它：
 *   解析结果决定两件事 ——「这张图允不允许存进桶里」（类型）
 *   和「九宫格占多大地方」（宽高）。读错了不报错，只是布局悄悄错位。
 *   而 JPEG 的「高在前宽在后」、WebP 的三种子格式、位打包，
 *   都是**看一眼觉得对、跑起来才发现错**的地方。
 *
 * 判据：**手工构造最小合法文件头**（不是真图片，但头完全合法），
 *   覆盖 PNG / JPEG（带与不带 EXIF 段）/ WebP 三种子格式 / 非法输入。
 *
 * 用法：
 *   cd server && pnpm run check:upload
 *
 * 退出码：0 = 全部一致；1 = 有偏差（可直接用于 CI / pre-commit）。
 */
import { buildCosAuthorization } from '../src/modules/upload/cos-sign';
import { readImageMeta } from '../src/modules/upload/image-meta';

let failed = 0;
let passed = 0;

function eq(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed += 1;
    console.log(`  ok  ${label}`);
    return;
  }
  failed += 1;
  console.log(`  ❌  ${label}\n        实际: ${a}\n        期望: ${e}`);
}

function ok(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed += 1;
    console.log(`  ok  ${label}`);
    return;
  }
  failed += 1;
  console.log(`  ❌  ${label}${detail ? `\n        ${detail}` : ''}`);
}

// ================================================================
// 一、COS 签名：官方示例逐项比对
// ================================================================

const SIGN_TIME = '1557989151;1557996351';
const EXPIRES_IN = 1557996351 - 1557989151;
const SECRET_ID = 'AKIDQjz3ltompVjBni5LitkWHFlFpwpn';
const SECRET_KEY = 'BQYIM75p8x0iWVFSIgqEKwFprpRSVHlz';

console.log('\n=== 一、COS 签名（官方示例「上传对象」）===');

const doc = buildCosAuthorization({
  secretId: SECRET_ID,
  secretKey: SECRET_KEY,
  method: 'PUT', // 文档请求行是大写 PUT，HttpString 里必须是小写 put
  pathname: '/exampleobject(腾讯云)', // 文档示例用的是**解码后**的路径
  headers: {
    'Content-Length': '13',
    'Content-MD5': 'mQ/fVh815F3k6TAUm8m0eg==',
    'Content-Type': 'text/plain',
    Date: 'Thu, 16 May 2019 06:45:51 GMT',
    Host: 'examplebucket-1250000000.cos.ap-beijing.myqcloud.com',
    'x-cos-acl': 'private',
    'x-cos-grant-read': 'uin="100000000011"',
  },
  expiresIn: EXPIRES_IN,
  now: 1557989151,
});

eq('KeyTime', doc.keyTime, SIGN_TIME);
eq('SignKey', doc.signKey, 'eb2519b498b02ac213cb1f3d1a3d27a3b3c9bc5f');
eq(
  'HttpString（小写方法 / 解码路径 / 空参数段 / 键排序 / 值 UrlEncode / 结尾 \\n）',
  doc.httpString,
  'put\n/exampleobject(腾讯云)\n\n' +
    'content-length=13&content-md5=mQ%2FfVh815F3k6TAUm8m0eg%3D%3D&content-type=text%2Fplain&' +
    'date=Thu%2C%2016%20May%202019%2006%3A45%3A51%20GMT&' +
    'host=examplebucket-1250000000.cos.ap-beijing.myqcloud.com&x-cos-acl=private&' +
    'x-cos-grant-read=uin%3D%22100000000011%22\n',
);
eq(
  'StringToSign',
  doc.stringToSign,
  'sha1\n1557989151;1557996351\n8b2751e77f43a0995d6e9eb9477f4b685cca4172\n',
);
ok(
  'Signature 前 28 位（文档末 4 位打码成 1234）',
  doc.signature.startsWith('3b8851a11a569213c17ba8fa7dcf2abec'),
  `实际: ${doc.signature}`,
);
eq(
  'Authorization 字段顺序',
  doc.authorization,
  'q-sign-algorithm=sha1' +
    `&q-ak=${SECRET_ID}` +
    `&q-sign-time=${SIGN_TIME}` +
    `&q-key-time=${SIGN_TIME}` +
    '&q-header-list=content-length;content-md5;content-type;date;host;x-cos-acl;x-cos-grant-read' +
    '&q-url-param-list=' +
    `&q-signature=${doc.signature}`,
);

// ----------------------------------------------------------------
// 二、COS 签名：本项目真实形状
// ----------------------------------------------------------------

console.log('\n=== 二、COS 签名（本项目上传的真实形状）===');

const HOST = 'family-1250000000.cos.ap-shanghai.myqcloud.com';
const base = {
  secretId: SECRET_ID,
  secretKey: SECRET_KEY,
  headers: { host: HOST },
  expiresIn: 600,
  now: 1790000000,
};

const real = buildCosAuthorization({
  ...base,
  method: 'put',
  pathname: '/memories/2026/10/a1b2c3.jpg',
});

eq('KeyTime = 起始;起始+有效期', real.keyTime, '1790000000;1790000600');
eq(
  'HttpString 只签 host，参数段为空',
  real.httpString,
  `put\n/memories/2026/10/a1b2c3.jpg\n\nhost=${HOST}\n`,
);
ok('q-header-list 只有 host', real.authorization.includes('q-header-list=host'));
ok('q-url-param-list 为空', real.authorization.includes('&q-url-param-list=&'));
eq(
  '幂等（同入参 → 同签名）',
  buildCosAuthorization({ ...base, method: 'put', pathname: '/memories/2026/10/a1b2c3.jpg' })
    .signature,
  real.signature,
);
ok(
  '不同 pathname → 不同签名',
  buildCosAuthorization({ ...base, method: 'put', pathname: '/memories/2026/10/ffffff.jpg' })
    .signature !== real.signature,
);

// 参数段：列表用 `;` 连接、键值对用 `&` 连接 —— 两处分隔符不一样，最容易写反
const withParams = buildCosAuthorization({
  ...base,
  method: 'get',
  pathname: '/memories/2026/10/a1b2c3.jpg',
  params: { 'response-content-type': 'image/jpeg', acl: '' },
});
ok(
  '参数段按字典序、值 UrlEncode',
  withParams.httpString.includes('\nacl=&response-content-type=image%2Fjpeg\n'),
  withParams.httpString,
);
ok(
  'q-url-param-list 用 ; 连接',
  withParams.authorization.includes('&q-url-param-list=acl;response-content-type&'),
);

// ================================================================
// 三、图片头解析
// ================================================================

console.log('\n=== 三、图片头解析 ===');

/** 合成一个 PNG 头：签名 + IHDR 段（宽高在固定偏移） */
function fakePng(width: number, height: number): Buffer {
  const b = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); // IHDR 段长度
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

/** 合成一个 JPEG：SOI + 可选 APP1(EXIF) 段 + SOF0 段 */
function fakeJpeg(width: number, height: number, withExif = false): Buffer {
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
  if (withExif) {
    // APP1：`FF E1 <长度> <负载>`。长度值 = 2（长度字段自身）+ 负载长度，
    // 所以整个段占 4 + 负载长度 字节 —— 少算那 2 字节就会让后续段错位。
    const payload = Buffer.from('Exif\0\0AB', 'latin1');
    const seg = Buffer.alloc(4 + payload.length);
    seg.writeUInt8(0xff, 0);
    seg.writeUInt8(0xe1, 1);
    seg.writeUInt16BE(2 + payload.length, 2);
    payload.copy(seg, 4);
    parts.push(seg);
  }
  // SOF0：长度 17 = 2 + 1(精度) + 2(高) + 2(宽) + 1(分量数) + 3×3
  const sof = Buffer.alloc(2 + 17);
  sof.writeUInt8(0xff, 0);
  sof.writeUInt8(0xc0, 1);
  sof.writeUInt16BE(17, 2);
  sof.writeUInt8(8, 4); // 精度
  sof.writeUInt16BE(height, 5); // ⚠️ 高在前
  sof.writeUInt16BE(width, 7); // ⚠️ 宽在后
  sof.writeUInt8(3, 9); // 分量数
  parts.push(sof);
  return Buffer.concat(parts);
}

/** 合成 WebP 外壳：RIFF....WEBP + 一个 chunk 头 */
function fakeWebp(fourcc: string, body: Buffer): Buffer {
  const head = Buffer.alloc(20);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(4 + 8 + body.length, 4);
  head.write('WEBP', 8, 'latin1');
  head.write(fourcc, 12, 'latin1');
  head.writeUInt32LE(body.length, 16);
  return Buffer.concat([head, body]);
}

function fakeWebpVp8(width: number, height: number): Buffer {
  const body = Buffer.alloc(10);
  body.writeUInt8(0x9d, 3);
  body.writeUInt8(0x01, 4);
  body.writeUInt8(0x2a, 5);
  body.writeUInt16LE(width, 6);
  body.writeUInt16LE(height, 8);
  return fakeWebp('VP8 ', body);
}

function fakeWebpVp8l(width: number, height: number): Buffer {
  const body = Buffer.alloc(5);
  body.writeUInt8(0x2f, 0);
  body.writeUInt32LE((width - 1) | ((height - 1) << 14), 1);
  return fakeWebp('VP8L', body);
}

function fakeWebpVp8x(width: number, height: number): Buffer {
  const body = Buffer.alloc(10);
  body.writeUIntLE(width - 1, 4, 3);
  body.writeUIntLE(height - 1, 7, 3);
  return fakeWebp('VP8X', body);
}

// --- 三种格式正常路径 ---
eq('PNG 1600×1200', readImageMeta(fakePng(1600, 1200)), {
  mime: 'image/png',
  width: 1600,
  height: 1200,
});
eq('JPEG 4032×3024（无 EXIF）', readImageMeta(fakeJpeg(4032, 3024)), {
  mime: 'image/jpeg',
  width: 4032,
  height: 3024,
});
eq('JPEG 1200×1600（带 EXIF，SOF 不在最前面）', readImageMeta(fakeJpeg(1200, 1600, true)), {
  mime: 'image/jpeg',
  width: 1200,
  height: 1600,
});
eq('WebP/VP8（有损）800×600', readImageMeta(fakeWebpVp8(800, 600)), {
  mime: 'image/webp',
  width: 800,
  height: 600,
});
eq('WebP/VP8L（无损）1024×768', readImageMeta(fakeWebpVp8l(1024, 768)), {
  mime: 'image/webp',
  width: 1024,
  height: 768,
});
eq('WebP/VP8X（扩展）2048×1536', readImageMeta(fakeWebpVp8x(2048, 1536)), {
  mime: 'image/webp',
  width: 2048,
  height: 1536,
});

// --- 宽高不对称，防「宽高写反」---
// 上面 JPEG 那两条已经是一横一竖，这里再用一个极端比例确认不是巧合
eq('JPEG 1×9999（极端比例）', readImageMeta(fakeJpeg(1, 9999)), {
  mime: 'image/jpeg',
  width: 1,
  height: 9999,
});

// --- 边界与非法输入 ---
eq('GIF 不认（V0.1 不支持动图）', readImageMeta(Buffer.from('GIF89a......', 'latin1')), {
  mime: null,
  width: null,
  height: null,
});
eq('空 buffer', readImageMeta(Buffer.alloc(0)), { mime: null, width: null, height: null });
eq('纯文本', readImageMeta(Buffer.from('hello world', 'utf8')), {
  mime: null,
  width: null,
  height: null,
});
eq('把 .exe 改名的 MZ 头', readImageMeta(Buffer.from('MZ\x90\x00\x03\x00\x00\x00', 'latin1')), {
  mime: null,
  width: null,
  height: null,
});
// 只有签名、没有 IHDR：类型仍认得出，尺寸给 null（**不抛异常**）
eq('截断的 PNG（只有签名）', readImageMeta(fakePng(10, 10).subarray(0, 10)), {
  mime: 'image/png',
  width: null,
  height: null,
});
// 只有 SOI 的 JPEG：同理
eq('截断的 JPEG（只有 SOI）', readImageMeta(Buffer.from([0xff, 0xd8, 0xff])), {
  mime: 'image/jpeg',
  width: null,
  height: null,
});
// 段长度非法（0）：不能死循环、不能抛异常
eq(
  'JPEG 段长度非法（0）',
  readImageMeta(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x00, 0x00, 0x00])),
  { mime: 'image/jpeg', width: null, height: null },
);
// WebP 容器对但子格式不认识
eq('WebP 未知子格式', readImageMeta(fakeWebp('ABCD', Buffer.alloc(8))), {
  mime: 'image/webp',
  width: null,
  height: null,
});
// VP8 同步码不对：不能瞎读
eq('WebP/VP8 同步码不对', readImageMeta(fakeWebp('VP8 ', Buffer.alloc(10))), {
  mime: 'image/webp',
  width: null,
  height: null,
});

console.log(`\n${failed === 0 ? '✅ 上传链路自检通过' : `❌ ${failed} 处不一致`}（${passed} 项）`);
process.exit(failed === 0 ? 0 : 1);
