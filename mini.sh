#!/usr/bin/env bash
set -euo pipefail

# =============================================================
# 家有小事 · 小程序自动上传脚本
# -------------------------------------------------------------
# 用 miniprogram-ci 把 miniprogram/ 直接上传到微信后台（不开开发者工具）。
#
# 用法：
#   bash mini.sh                          # 版本号取根 package.json
#   bash mini.sh 0.1.1 "修复首页空态"
#   bash mini.sh --preview                # 只出预览二维码（真机验 UI），不上传
#   bash mini.sh --strict                 # 云托管环境 ID 还是占位符时直接失败
#   bash mini.sh --npm                    # 上传前先「构建 npm」（见下注）
#   bash mini.sh --no-pull                # 跳过 git pull
#
# 前置条件（两件，缺一不可，都在微信公众平台配）：
#   ① 开发 → 开发管理 → 开发设置 → **小程序代码上传** → 生成上传密钥（.key 文件）
#      放到仓库根，命名 .miniprogram.key（或任意 private.*.key），
#      也可以用环境变量 PRIVATE_KEY_PATH 指定。
#   ② 同一处的 **IP 白名单** —— 上传接口的调用 IP 必须在白名单里，
#      不在白名单会报 "invalid ip ... not in whitelist"，跟密钥对不对无关。
#      ⚠️ 家用宽带 IP 会变，换网络后要重新加。
#
# 环境变量（都不填也能跑：APPID 会回落到 project.config.json）：
#   WECHAT_APP_ID / WX_APPID / APPID   小程序 appid
#   PRIVATE_KEY_PATH                   上传密钥路径
#   MP_ROBOT                           CI 机器人编号 1-30，默认 1
# =============================================================

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# ⚠️ projectPath 必须是 **project.config.json 所在的目录**。
#    本项目是原生 TS 小程序（setting.useCompilerPlugins 里有 typescript），
#    miniprogram-ci 靠读这份配置才知道要编译 TS —— 指错目录的话它拿不到配置，
#    会原样上传 .ts 源码，上传能成功、真机直接白屏。
MP_DIR="$ROOT_DIR/miniprogram"
CONFIG_FILE="$MP_DIR/project.config.json"
CI_DIR="$ROOT_DIR/.ci-tools"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'
log()   { echo -e "${GREEN}[mini]${NC} $1"; }
warn()  { echo -e "${YELLOW}[warn]${NC} $1"; }
error() { echo -e "${RED}[error]${NC} $1"; exit 1; }

# ---------- 参数 ----------
PREVIEW=0
PACK_NPM=0
STRICT=0
DO_PULL=1
POSITIONAL=()
while [ $# -gt 0 ]; do
  case "$1" in
    --preview) PREVIEW=1; shift ;;
    --npm)     PACK_NPM=1; shift ;;
    --strict)  STRICT=1; shift ;;
    --no-pull) DO_PULL=0; shift ;;
    -h|--help) sed -n '2,40p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) POSITIONAL+=("$1"); shift ;;
  esac
done

# ---------- 1. 前置检查 ----------
[ -d "$MP_DIR" ]      || error "找不到小程序目录：$MP_DIR"
[ -f "$CONFIG_FILE" ] || error "找不到 $CONFIG_FILE（miniprogram-ci 靠它识别 TS 编译插件）"

command -v node >/dev/null 2>&1 || error "未安装 node（本项目要求 >= 22）"
command -v pnpm >/dev/null 2>&1 || warn "未安装 pnpm，依赖安装步骤会失败"

APPID="${WECHAT_APP_ID:-${WX_APPID:-${APPID:-}}}"
if [ -z "$APPID" ]; then
  APPID="$(node -p "JSON.parse(require('fs').readFileSync('$CONFIG_FILE','utf8')).appid" 2>/dev/null || true)"
fi
[ -n "$APPID" ] || error "拿不到 appid：设置 WECHAT_APP_ID，或在 $CONFIG_FILE 里配 appid"

PRIVATE_KEY_PATH="${PRIVATE_KEY_PATH:-$ROOT_DIR/.miniprogram.key}"
if [ ! -f "$PRIVATE_KEY_PATH" ]; then
  # 兼容微信后台下载下来的默认文件名 private.wx<appid>.key
  for f in "$ROOT_DIR"/private.*.key; do
    if [ -f "$f" ]; then PRIVATE_KEY_PATH="$f"; break; fi
  done
fi
if [ ! -f "$PRIVATE_KEY_PATH" ]; then
  error "未找到上传密钥：$PRIVATE_KEY_PATH
  请到 微信公众平台 → 开发管理 → 开发设置 → 小程序代码上传 下载密钥，
  放到仓库根命名为 .miniprogram.key（或设 PRIVATE_KEY_PATH）。
  别忘了同一页面还要配 **IP 白名单**。"
fi

VERSION="${POSITIONAL[0]:-}"
if [ -z "$VERSION" ]; then
  VERSION="$(node -p "require('$ROOT_DIR/package.json').version" 2>/dev/null || echo '0.1.0')"
fi
DESC="${POSITIONAL[1]:-}"
if [ -z "$DESC" ]; then
  DESC="自动上传 $(date '+%Y-%m-%d %H:%M:%S')"
fi

log "appid    $APPID"
log "项目目录 $MP_DIR"
log "密钥     $PRIVATE_KEY_PATH"
log "版本     $VERSION"
log "备注     $DESC"

# ---------- 2. 准备 miniprogram-ci ----------
# 装到 .ci-tools/ 而不是全局：不污染仓库依赖、不写进 package.json，
# 换机器重跑能自动补上。.ci-tools 已加进 .gitignore。
if ! (NODE_PATH="$CI_DIR/node_modules" node -e "require.resolve('miniprogram-ci')" >/dev/null 2>&1); then
  log "安装 miniprogram-ci 到 .ci-tools/ ..."
  mkdir -p "$CI_DIR"
  ( cd "$CI_DIR" && npm init -y >/dev/null 2>&1 && npm install miniprogram-ci --no-audit --no-fund )
fi
export NODE_PATH="$CI_DIR/node_modules"

# ---------- 3. 拉代码（工作区脏就跳过，别把改动冲掉）----------
if [ "$DO_PULL" = 1 ] && [ -d "$ROOT_DIR/.git" ]; then
  BRANCH="$(git -C "$ROOT_DIR" branch --show-current 2>/dev/null || echo master)"
  if [ -n "$(git -C "$ROOT_DIR" status --porcelain)" ]; then
    warn "工作区有未提交改动，跳过 git pull"
  else
    log "拉取 origin/$BRANCH ..."
    git -C "$ROOT_DIR" pull --ff-only origin "$BRANCH" || warn "git pull 失败，用当前工作区继续"
  fi
fi

# ---------- 4. 装依赖 ----------
log "安装依赖..."
( cd "$ROOT_DIR" && pnpm install --frozen-lockfile ) || ( cd "$ROOT_DIR" && pnpm install )

# ---------- 5. 上传前静态校验 ----------
# 两个都是纯本地、几秒钟：typecheck 保证 TS 能过，check-mp 保证页面/组件完整。
log "类型检查..."
( cd "$ROOT_DIR" && pnpm --filter @jyss/miniprogram run typecheck )
log "小程序端自查..."
( cd "$ROOT_DIR" && node tools/check-mp.mjs ) || warn "check-mp 有告警，见上方输出"

# ⚠️ 业务后端域名还是占位符的话，传上去的体验版所有接口都不通（首页空、登录失败）。
#    默认只警告 —— 想先给家人看 UI 的话照样能传；加 --strict 就变成硬失败。
if grep -q "REPLACE-WITH-CLOUD-RUN-ENV-ID" "$MP_DIR/config.ts"; then
  warn "miniprogram/config.ts 的 CLOUD_RUN_ENV_ID 还是占位符 —— 体验版/正式版无法调用云托管"
  if [ "$STRICT" = 1 ]; then
    error "CLOUD_RUN_ENV_ID 未替换（--strict）。先填云托管环境 ID 再上传。"
  fi
fi

# ---------- 6. 上传 / 预览 ----------
cat > "$CI_DIR/run-ci.js" <<'JS'
const ci = require('miniprogram-ci');

const project = new ci.Project({
  appid: process.env.MP_APPID,
  type: 'miniProgram',
  projectPath: process.env.MP_DIR,
  privateKeyPath: process.env.MP_KEY,
  ignores: ['node_modules/**/*', '.git/**/*', '**/*.md'],
});

// 与 miniprogram/project.config.json 的 setting 对齐，但强制开压缩
// （项目里 minified:false 是为了本地调试方便，线上要压）。
const setting = {
  es6: true,
  es7: true,
  minify: true,
  minifyJS: true,
  minifyWXML: true,
  minifyWXSS: true,
  autoPrefixWXSS: true,
};
const robot = Number(process.env.MP_ROBOT || 1);

(async () => {
  if (process.env.MP_PACK_NPM === '1') {
    console.log('构建 npm ...');
    await ci.packNpm(project, { ignores: ['**/*.md'], reporter: console.log });
  }

  if (process.env.MP_MODE === 'preview') {
    const r = await ci.preview({
      project,
      desc: process.env.MP_DESC,
      setting,
      robot,
      qrcodeFormat: 'image',
      qrcodeOutputDest: process.env.MP_QRCODE,
      onProgressUpdate: console.log,
    });
    console.log('预览二维码：' + process.env.MP_QRCODE);
    console.log(JSON.stringify(r, null, 2));
    return;
  }

  const r = await ci.upload({
    project,
    version: process.env.MP_VERSION,
    desc: process.env.MP_DESC,
    setting,
    robot,
    onProgressUpdate: console.log,
  });
  console.log('上传成功：' + JSON.stringify(r, null, 2));
})().catch((err) => {
  console.error('失败：' + (err && err.message ? err.message : err));
  process.exit(1);
});
JS

export MP_APPID="$APPID"
export MP_DIR="$MP_DIR"
export MP_KEY="$PRIVATE_KEY_PATH"
export MP_VERSION="$VERSION"
export MP_DESC="$DESC"
export MP_ROBOT="${MP_ROBOT:-1}"
export MP_PACK_NPM="$PACK_NPM"
export MP_QRCODE="$ROOT_DIR/preview-qrcode.jpg"

if [ "$PREVIEW" = 1 ]; then
  # ⚠️ 预览用的是 develop 环境 → BASE_URL = http://localhost:3000，
  #    手机上的 localhost 是手机自己，接口不通，只能看 UI。想真机联调要
  #    先把 config.ts 的 DEV_BASE_URL 改成本机局域网 IP。
  export MP_MODE=preview
  log "生成预览二维码..."
else
  export MP_MODE=upload
  log "上传代码到微信后台..."
  if [ "$PACK_NPM" = 1 ]; then
    warn "开了 --npm：还要确认 project.config.json 的 setting.nodeModules 为 true，否则构建出来的 miniprogram_npm 不会被打包"
  fi
fi

node "$CI_DIR/run-ci.js"

if [ "$PREVIEW" = 1 ]; then
  log "预览完成，二维码：$MP_QRCODE"
else
  log "上传完成！"
  log "下一步：微信公众平台 → 版本管理 → 开发版本 → 提交审核（或先选为体验版）"
fi
