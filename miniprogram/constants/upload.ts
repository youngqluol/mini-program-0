/**
 * 上传限制 —— **镜像**
 *
 * 权威来源：`packages/shared/src/dto/upload.ts` 的 `UPLOAD_LIMITS`。
 * 小程序端的 TypeScript 编译只做类型擦除、不解析 `paths`，
 * 所以运行时的值必须在这里再写一份，由 `tools/check-shared.mjs` 逐字比对。
 *
 * 漂移了会怎样：后端 multer 按权威来源拦（40001「超过 5MB」），
 * 前端按镜像放行 —— 用户看到的就是「图片明明选上了，一直传不上去」。
 * 体验版/正式版走直传，**后端根本看不到字节**，这道拦截只剩前端一份，
 * 于是它从「体验优化」升级成了唯一的规则执行点。
 */
export const UPLOAD_LIMITS = {
  /** 单张图片大小上限（字节）：5MB */
  MAX_IMAGE_BYTES: 5 * 1024 * 1024,
} as const;
