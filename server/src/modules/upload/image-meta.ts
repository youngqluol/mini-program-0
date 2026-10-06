/**
 * 图片头解析 —— 只做两件事：**认真实类型**、**读宽高**。纯函数，零依赖。
 *
 * ## 为什么要自己解析
 *
 * ① **认类型不能信客户端。** multipart 里的 `Content-Type` 是客户端填的，
 *    把 `.exe` 说成 `image/jpeg` 是零成本的。真正的判据是**文件头的魔术字节**。
 *    这个判断直接决定「允不允许存进桶里」，所以必须自己看。
 *
 * ② **宽高是九宫格布局要用的。** 存进 `memory_attachments.width/height`，
 *    前端按比例占位，图片加载时不会跳动。让客户端上报也行，但那三个数字
 *    就成了「客户端说了算」——一张图错报 10000×10000 能把页面撑爆。
 *
 * ## 只认三种格式
 *
 * PRD §18.2 定死了 jpg / png / webp。GIF 不支持（动图会带来「体积上限」
 * 和「内容安全只检首帧」两个新问题，V0.1 不做）。
 *
 * ## 解不出来时返回 `null`，**绝不抛异常、绝不猜**
 *
 * 图片头可能被裁剪、可能是新版本变体。这时 `width/height` 给 `null`
 * （`memory_attachments` 的两列本来就允许 NULL），上传照常进行 ——
 * 「解不出尺寸」不该让家人传不了照片。但**类型认不出来就是硬拒绝**，
 * 因为那关系到存进去的是不是图片。
 */

/** 支持的三种图片 MIME */
export type SupportedImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export interface ImageMeta {
  /** 嗅探出的真实 MIME；**不属于三种支持格式时为 `null`** */
  mime: SupportedImageMime | null;
  /** 解不出来时为 `null` */
  width: number | null;
  height: number | null;
}

/** PNG 的 8 字节文件签名 */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 读一张图片的类型与宽高。**永不抛异常。** */
export function readImageMeta(buf: Buffer): ImageMeta {
  if (isPng(buf)) return pngMeta(buf);
  if (isJpeg(buf)) return jpegMeta(buf);
  if (isWebp(buf)) return webpMeta(buf);
  return { mime: null, width: null, height: null };
}

// ---------------------------------------------------------------
// PNG
// ---------------------------------------------------------------

function isPng(buf: Buffer): boolean {
  return buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE);
}

/**
 * PNG 的宽高就在 IHDR 里，位置固定：
 *   0..7   签名
 *   8..11  第一个 chunk 的长度（恒为 13）
 *   12..15 chunk 类型 "IHDR"
 *   16..19 宽（大端 uint32）
 *   20..23 高（大端 uint32）
 * 这是三种格式里唯一**不用扫描**的，所以最可靠。
 */
function pngMeta(buf: Buffer): ImageMeta {
  if (buf.length < 24 || buf.toString('latin1', 12, 16) !== 'IHDR') {
    return { mime: 'image/png', width: null, height: null };
  }
  return { mime: 'image/png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// ---------------------------------------------------------------
// JPEG
// ---------------------------------------------------------------

function isJpeg(buf: Buffer): boolean {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8;
}

/**
 * JPEG 要**逐段扫描**才能找到 SOFn（帧起始）段 —— 前面可能有
 * EXIF（手机照片常见，几 KB）、缩略图、注释等任意多个段。
 *
 * 每个段的形状是 `FF <marker> <2 字节长度> <内容>`，长度**包含自己那 2 字节**。
 * 例外是几个「无长度」标记，以及 SOS（之后就是压缩数据，必须停）。
 *
 * SOFn 段内：+2 精度、+3..4 高、+5..6 宽（相对 marker 位置）。
 * 注意**高在前、宽在后** —— 这是最容易写反的一处。
 */
function jpegMeta(buf: Buffer): ImageMeta {
  const meta: ImageMeta = { mime: 'image/jpeg', width: null, height: null };
  let i = 2;

  while (i + 1 < buf.length) {
    if (buf[i] !== 0xff) {
      // 段间偶有填充字节，跳过而不是放弃
      i += 1;
      continue;
    }
    const marker = buf[i + 1];
    if (marker === 0xff) {
      i += 1; // 填充
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break; // EOI / SOS：SOF 必然在更前面
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2; // 无长度字段的标记
      continue;
    }

    if (i + 4 > buf.length) break;
    const segLen = buf.readUInt16BE(i + 2);
    if (segLen < 2) break; // 长度不合法，别再往下滚了

    // SOF0..SOF15，但 C4=DHT、C8=JPG、CC=DAC 不是帧起始段
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (i + 9 > buf.length) break;
      meta.height = buf.readUInt16BE(i + 5);
      meta.width = buf.readUInt16BE(i + 7);
      return meta;
    }

    i += 2 + segLen;
  }

  return meta; // 没找到 SOF：类型认得出，尺寸给 null
}

// ---------------------------------------------------------------
// WebP
// ---------------------------------------------------------------

function isWebp(buf: Buffer): boolean {
  return (
    buf.length >= 16 &&
    buf.toString('latin1', 0, 4) === 'RIFF' &&
    buf.toString('latin1', 8, 12) === 'WEBP'
  );
}

/**
 * WebP 有**三个互不兼容的子格式**，宽高的读法各不相同：
 *
 *   VP8 （有损，最常见） 帧头里 14 位宽 + 14 位高，位置固定
 *   VP8L（无损）         5 字节头里**位打包**，宽高各 14 位、存的是「减一」
 *   VP8X（扩展，含动图/透明）24 位画布宽高，同样存的是「减一」
 *
 * 微信压缩后的图片通常是 VP8，但浏览器/编辑器导出的可能是另两种，
 * 所以三种都要认 —— 认不出就返回 null，不影响上传。
 */
function webpMeta(buf: Buffer): ImageMeta {
  const meta: ImageMeta = { mime: 'image/webp', width: null, height: null };
  const fourcc = buf.toString('latin1', 12, 16);

  if (fourcc === 'VP8 ') {
    // 12..15 "VP8 "、16..19 块长度、20..22 帧标签、23..25 同步码 9D 01 2A
    if (buf.length < 30 || buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return meta;
    return {
      mime: 'image/webp',
      width: buf.readUInt16LE(26) & 0x3fff,
      height: buf.readUInt16LE(28) & 0x3fff,
    };
  }

  if (fourcc === 'VP8L') {
    // 20 是签名字节 0x2F，21..24 是位打包的「宽-1 / 高-1」
    if (buf.length < 25 || buf[20] !== 0x2f) return meta;
    const bits = buf.readUInt32LE(21);
    return {
      mime: 'image/webp',
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }

  if (fourcc === 'VP8X') {
    // 24..26 画布宽-1（小端 24 位）、27..29 画布高-1
    if (buf.length < 30) return meta;
    return {
      mime: 'image/webp',
      width: buf.readUIntLE(24, 3) + 1,
      height: buf.readUIntLE(27, 3) + 1,
    };
  }

  return meta;
}
