import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { Public } from '../../common/decorators/current-user.decorator';
import { MpTemplateKind } from './notify.templates';

/**
 * 推送落地页（中转页）—— 用户点不开小程序时看到的那一张网页。
 *
 * 2026-11-12 从 Cloudflare Worker 的 `/skin` 搬进后端：Worker 出不到，
 * 落地页也就跟着一起没了（`docs/08` §十五 第 8 行）。
 *
 * 视觉规格见 `docs/07` §十（柔光粉彩，**不是**上游 wxpush 的深蓝科幻风）。
 * 路径受全局前缀影响，实际是 `GET /api/skin`，由环境变量 `MP_LANDING_URL` 指过来。
 *
 * ⚠️ 文案纪律：这一页**不许**出现「测试号 / 公众号 / 关注 / 绑定 / 授权」这类词，
 *    用户在这里只需要知道「去小程序里看」。
 */

/** 通知种类 → 「图标 + 底色」，取值见 docs/07 §10.3 */
const KIND_STYLE: Record<string, { emoji: string; bg: string }> = {
  [MpTemplateKind.TASK]: { emoji: '🎯', bg: '#FFEFE0' },
  [MpTemplateKind.REMINDER]: { emoji: '🔔', bg: '#FFE4EA' },
  [MpTemplateKind.DONE]: { emoji: '✅', bg: '#E3F3E6' },
};

const FALLBACK_STYLE = { emoji: '💬', bg: '#E3F0FB' };

@Public()
@Controller('skin')
export class LandingController {
  constructor(private readonly config: ConfigService) {}

  @Get()
  page(
    @Query('title') title?: string,
    @Query('message') message?: string,
    @Query('date') date?: string,
    @Query('kind') kind?: string,
    @Res() res?: Response,
  ): void {
    const style = (kind && KIND_STYLE[kind]) || FALLBACK_STYLE;
    const qres = res as Response;
    qres.header('Content-Type', 'text/html; charset=utf-8');
    // 落地页是一次性页面，不许被任何缓存留住（改了样式刷新看不到很误导）
    qres.header('Cache-Control', 'no-store');
    qres.send(
      render({
        emoji: style.emoji,
        iconBg: style.bg,
        title,
        message,
        date,
        mpName: this.config.get<string>('MP_NAME')?.trim() || '家有小事',
        qrcodeUrl: this.config.get<string>('MP_QRCODE_URL')?.trim() ?? '',
      }),
    );
  }
}

interface PageInput {
  emoji: string;
  iconBg: string;
  title?: string;
  message?: string;
  date?: string;
  /** 小程序名称，用于跳转引导文案 */
  mpName: string;
  /** 小程序码图片地址（`docs/06` 3.1.9 生成后填入），空 = 只给文字引导 */
  qrcodeUrl: string;
}

function render(input: PageInput): string {
  const head = escapeHtml(cut(input.title, 60)) || '家里的一点小事';
  const body = escapeHtml(cut(input.message, 300)) || '有件事跟你交代一声～';
  const time = escapeHtml(cut(input.date, 32));
  const name = escapeHtml(input.mpName);

  const jumpBlock = input.qrcodeUrl
    ? `<div class="qr">
        <img src="${escapeHtml(input.qrcodeUrl)}" alt="小程序码">
        <p>长按识别小程序码，打开「${name}」</p>
      </div>`
    : `<p class="tip">打不开的话，在微信里搜索「${name}」小程序就能看到</p>`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${head}</title>
<style>
  body{margin:0;background:#FDF6F7;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",sans-serif;color:#1F1F1F;display:flex;justify-content:center;padding:32px 16px}
  .wrap{width:100%;max-width:420px}
  .card{background:#fff;border-radius:20px;box-shadow:0 4px 18px rgba(255,150,170,.10);padding:24px}
  .icon{width:52px;height:52px;border-radius:18px;background:${input.iconBg};display:flex;align-items:center;justify-content:center;font-size:26px;margin-bottom:16px}
  .title{font-size:17px;font-weight:600;line-height:1.5}
  .split{height:1px;background:#F5EDEF;margin:16px 0}
  .body{font-size:14px;color:#6B6B70;line-height:1.7;white-space:pre-wrap;word-break:break-word}
  .time{margin-top:16px;font-size:12px;color:#9B9B9B}
  .qr{margin-top:16px;background:#fff;border:1px solid #F5EDEF;border-radius:14px;padding:16px;text-align:center}
  .qr img{width:180px;height:180px;border-radius:8px}
  .qr p{margin:12px 0 0;font-size:12px;color:#9B9B9B;line-height:1.6}
  .tip{margin:20px 0 0;font-size:12px;color:#9B9B9B;text-align:center;line-height:1.6}
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="icon">${input.emoji}</div>
      <div class="title">${head}</div>
      <div class="split"></div>
      <div class="body">${body}</div>
      ${time ? `<div class="time">${time}</div>` : ''}
    </div>
    ${jumpBlock}
  </div>
</body>
</html>`;
}

function cut(value: string | undefined, max: number): string {
  const s = (value ?? '').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
