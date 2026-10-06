import {
  Controller,
  Get,
  Header,
  Logger,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators/current-user.decorator';
import { MpBindService } from './mp-bind.service';

/**
 * 微信公众号（测试号）消息回调。
 *
 * 用途：接收用户发给公众号的消息，从中拿到**公众号 openid**，
 *       配合绑定码完成「小程序用户 ↔ 公众号 openid」的绑定。
 *
 * 配置位置：测试号后台 → 「接口配置信息」
 *   URL   : https://<后端域名>/api/wechat/mp-callback
 *   Token : 与后端环境变量 MP_CALLBACK_TOKEN 一致
 *
 * ⚠️ 整个 controller 标了 `@Public()`：请求来自微信服务器，没有用户 token，
 *    安全性由 signature 签名校验保证。
 * ⚠️ 必须使用**明文模式**（测试号默认）。若开了安全模式（AES 加密），
 *    需要额外实现 `WXBizMsgCrypt` 解密，V0.1 不做。
 */
@Public()
@Controller('wechat')
export class MpCallbackController {
  private readonly logger = new Logger(MpCallbackController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly mpBind: MpBindService,
  ) {}

  /**
   * 微信服务器配置校验。
   *
   * 在测试号后台点「提交」时，微信会发一个 GET 请求，
   * 我们必须校验签名并把 `echostr` 原样返回，配置才会生效。
   */
  @Get('mp-callback')
  verify(
    @Query('signature') signature: string,
    @Query('timestamp') timestamp: string,
    @Query('nonce') nonce: string,
    @Query('echostr') echostr: string,
    @Res() res: Response,
  ): void {
    if (this.checkSignature(signature, timestamp, nonce)) {
      this.logger.log('微信服务器校验通过');
      res.send(echostr ?? '');
      return;
    }
    this.logger.warn('微信服务器校验失败：签名不匹配');
    res.status(403).send('invalid signature');
  }

  /**
   * 接收用户消息。
   *
   * 约定：用户发给公众号的**纯数字消息**被当作绑定码处理，
   *       其余消息一律忽略（回一句引导语）。
   */
  @Post('mp-callback')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  async onMessage(@Req() req: Request, @Res() res: Response): Promise<void> {
    const { signature, timestamp, nonce } = req.query as Record<string, string>;
    if (!this.checkSignature(signature, timestamp, nonce)) {
      this.logger.warn('收到消息但签名不匹配，已丢弃');
      res.status(403).send('');
      return;
    }

    const xml = await readRawBody(req);
    const fromUser = pickTag(xml, 'FromUserName'); // 公众号 openid
    const toUser = pickTag(xml, 'ToUserName'); // 公众号原始 id
    const msgType = pickTag(xml, 'MsgType');
    const content = pickTag(xml, 'Content') ?? '';

    if (!fromUser || !toUser) {
      this.logger.warn('消息缺少 FromUserName / ToUserName，已忽略');
      res.send('success');
      return;
    }

    // 只处理文本消息
    if (msgType !== 'text') {
      res.send(this.buildTextReply(fromUser, toUser, '发一个 6 位绑定码给我就能绑定啦～'));
      return;
    }

    let replyText: string;
    try {
      replyText = await this.mpBind.bindByCode(fromUser, content);
    } catch (e) {
      this.logger.error(`绑定失败: ${e instanceof Error ? e.message : String(e)}`);
      replyText = '刚才没绑上，稍后再试一次～';
    }

    res.send(this.buildTextReply(fromUser, toUser, replyText));
  }

  // -------------------------------------------------------------
  // 内部工具
  // -------------------------------------------------------------

  /** 微信签名校验：sha1(sort([token, timestamp, nonce]).join('')) */
  private checkSignature(signature?: string, timestamp?: string, nonce?: string): boolean {
    const token = this.config.get<string>('MP_CALLBACK_TOKEN');
    if (!token || !signature || !timestamp || !nonce) return false;

    const raw = [token, timestamp, nonce].sort().join('');
    const calc = createHash('sha1').update(raw).digest('hex');
    return calc === signature;
  }

  /** 拼一条文本回复的 XML */
  private buildTextReply(toUser: string, fromUser: string, content: string): string {
    return `<xml>
  <ToUserName><![CDATA[${toUser}]]></ToUserName>
  <FromUserName><![CDATA[${fromUser}]]></FromUserName>
  <CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime>
  <MsgType><![CDATA[text]]></MsgType>
  <Content><![CDATA[${content}]]></Content>
</xml>`;
  }
}

/** 读取原始请求体（微信回调是 XML，不走 JSON body parser） */
async function readRawBody(req: Request): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * 从 XML 里取一个标签的值。
 *
 * ⚠️ 这是极简实现，够用但不够健壮。M1 接入时建议换成 `fast-xml-parser`，
 *    并注意防范 XXE（禁用外部实体）。
 */
function pickTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))\\s*</${tag}>`);
  const m = re.exec(xml);
  if (!m) return null;
  return (m[1] ?? m[2] ?? '').trim() || null;
}
