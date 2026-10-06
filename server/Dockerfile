# =============================================================
# 后端镜像（微信云托管「自定义部署」用）
# =============================================================
# 要点：
#   - Node 22 LTS（Node 20 已于 2026-04-30 EOL，不要再用）
#   - 必须设置 TZ=Asia/Shanghai，否则定时任务时间会错
#   - 镜像内不含 .env，所有配置由云托管环境变量注入
#   - 云托管要求监听 0.0.0.0，端口读 PORT 环境变量
# =============================================================

# ---------- 构建阶段 ----------
FROM node:22-alpine AS builder

WORKDIR /app

# 先装依赖，利用 Docker 层缓存
RUN corepack enable

# 只拷贝 workspace 清单，依赖不变时这一层可复用
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY server/package.json ./server/
COPY packages/shared/package.json ./packages/shared/

RUN pnpm install --filter @jyss/server... --frozen-lockfile=false

# 再拷贝源码
COPY packages/shared ./packages/shared
COPY server ./server

WORKDIR /app/server
RUN pnpm exec prisma generate && pnpm run build

# ---------- 运行阶段 ----------
FROM node:22-alpine

WORKDIR /app
ENV TZ=Asia/Shanghai
ENV NODE_ENV=production

RUN corepack enable

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server/node_modules ./server/node_modules
# ⚠️ 拷的是整个 dist：里面既有 server 也有编译后的 packages/shared。
#    两者缺一不可 —— 别名重写后的相对路径会跨到 dist/packages/ 去。
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/server/prisma ./server/prisma

WORKDIR /app/server
EXPOSE 3000

# ⚠️ 入口是 dist/server/src/main.js，不是 dist/main.js。
#    原因见 docs/04 §一 的说明（rootDir 推断成了仓库根目录）。
CMD ["node", "dist/server/src/main.js"]
