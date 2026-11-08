/**
 * 第三方推送通知适配器。
 *
 * 渠道形态与 kkapi-open 的 noticeType 对齐，便于从其配置迁移。
 * 每个渠道只负责「拼 URL + 拼载荷 + 发请求」，失败不抛出（返回 ok:false），
 * 便于上层决定是否重试或记录日志。
 */
import type { NoticeConfig, NoticePayload } from '../../../shared/types.js';

export const NOTICE_TYPES = [
  'telegram',
  'wecom',
  'dingtalk',
  'bark',
  'pushplus',
  'pushdeer',
  'serverchan',
  'igot',
  'qmsg',
  'gocqhttp',
  'webhook',
] as const;

export type NoticeChannel = (typeof NOTICE_TYPES)[number];

interface RequestSpec {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
}

/** 把「标题 + 正文」排版成适合文本渠道的字符串 */
function text(p: NoticePayload): string {
  return p.title ? `${p.title}\n${p.content}` : p.content;
}

/** telegram 的 token 形态为 `<botToken>/<chatId>` 或 `<botToken>|<chatId>` */
function splitTelegram(token: string): { bot: string; chat: string } {
  const [bot, chat] = token.split(/[|/]/);
  return { bot: bot ?? '', chat: chat ?? '' };
}

function buildRequest(cfg: NoticeConfig, p: NoticePayload): RequestSpec | null {
  const t = cfg.token.trim();
  if (!t) return null;

  switch (cfg.type) {
    case 'telegram': {
      const { bot, chat } = splitTelegram(t);
      if (!bot || !chat) return null;
      return {
        url: `https://api.telegram.org/bot${bot}/sendMessage`,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text: text(p), disable_web_page_preview: true }),
      };
    }

    case 'wecom':
      // 企业微信群机器人：webhook 地址或 key
      return {
        url: t.startsWith('http') ? t : `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${t}`,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ msgtype: 'text', text: { content: text(p) } }),
      };

    case 'dingtalk':
      return {
        url: t.startsWith('http') ? t : `https://oapi.dingtalk.com/robot/send?access_token=${t}`,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ msgtype: 'text', text: { content: text(p) } }),
      };

    case 'bark':
      return {
        url: `https://api.day.app/${t}`,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: p.title || '通知', body: p.content, ...(p.url ? { url: p.url } : {}) }),
      };

    case 'pushplus':
      return {
        url: 'https://www.pushplus.plus/send',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: t, title: p.title || '通知', content: p.content, ...(p.url ? { url: p.url } : {}) }),
      };

    case 'pushdeer':
      return {
        url: t.startsWith('http') ? t : 'https://api2.pushdeer.com/message/push',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pushkey: t, text: p.title || '通知', desp: p.content, type: 'text' }),
      };

    case 'serverchan':
      return {
        url: `https://sctapi.ftqq.com/${t}.send`,
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ title: p.title || '通知', desp: p.content }).toString(),
      };

    case 'igot':
      return {
        url: `https://push.re/${t}`,
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ title: p.title || '通知', body: p.content }).toString(),
      };

    case 'qmsg':
      return {
        url: `https://qmsg.zendee.cn/send/${t}`,
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ msg: text(p) }).toString(),
      };

    case 'gocqhttp':
      // go-cqhttp 的 HTTP POST 地址，通常形如 http://127.0.0.1:5700/send_private_msg
      return {
        url: t,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: text(p) }),
      };

    case 'webhook':
      return {
        url: t,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(p),
      };

    default:
      return null;
  }
}

export interface NoticeResult {
  ok: boolean;
  status?: number;
  error?: string;
}

/**
 * 推送到单个渠道。网络失败 / 非 2xx 均返回 ok:false，不抛异常。
 */
export async function sendNotice(cfg: NoticeConfig, p: NoticePayload): Promise<NoticeResult> {
  const req = buildRequest(cfg, p);
  if (!req) return { ok: false, error: 'invalid channel config' };

  try {
    const res = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      signal: AbortSignal.timeout(8000),
    });
    return { ok: res.ok, status: res.status, error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** 批量推送，单条失败不影响其他 */
export async function sendNoticeAll(
  configs: NoticeConfig[],
  p: NoticePayload,
): Promise<Array<{ id: string; type: string } & NoticeResult>> {
  return Promise.all(
    configs.map(async (c) => ({
      id: c.id,
      type: c.type,
      ...(await sendNotice(c, p)),
    })),
  );
}
