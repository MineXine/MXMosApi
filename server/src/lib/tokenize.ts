/**
 * 中文/英文混合分词。
 *
 * MongoDB 原生 text index 对中文支持极弱（按空白切分），因此这里采用
 * 「CJK 二元组（bigram）+ 拉丁词」的方式生成检索 token，写入 `searchTokens` 数组字段，
 * 配合多值索引 + $all 查询实现可用的中文全文检索。
 *
 * - 中文/日文/韩文：生成 1 字与 2 字组合，短查询也能命中
 * - 拉丁字母/数字：整体转小写作为单词 token
 */
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/;

/** 英文前缀索引长度：超过该长度的单词额外写入前 4 字符作为前缀 token */
const PREFIX_LEN = 4;

/**
 * 生成「索引 token」：写入文档时使用。
 * - 中文/日文/韩文：生成 1 字与 2 字组合，短查询也能命中
 * - 拉丁字母/数字：完整小写单词 + 前 4 字符前缀
 */
export function tokenize(input: string): string[] {
  if (!input) return [];
  const tokens = new Set<string>();
  const text = input.toLowerCase();

  let latin = '';
  let cjkRun = '';

  const flushLatin = () => {
    if (latin.length > 0) {
      tokens.add(latin);
      if (latin.length > PREFIX_LEN) tokens.add(latin.slice(0, PREFIX_LEN));
      latin = '';
    }
  };

  const flushCjk = () => {
    if (!cjkRun) return;
    for (let i = 0; i < cjkRun.length; i++) {
      tokens.add(cjkRun[i]);
      if (i + 1 < cjkRun.length) tokens.add(cjkRun.slice(i, i + 2));
    }
    cjkRun = '';
  };

  for (const ch of text) {
    if (CJK.test(ch)) {
      flushLatin();
      cjkRun += ch;
    } else if (/[a-z0-9_#@.+-]/.test(ch)) {
      flushCjk();
      latin += ch;
    } else {
      flushLatin();
      flushCjk();
    }
  }
  flushLatin();
  flushCjk();

  return [...tokens];
}

/**
 * 生成「查询 token」：检索时使用。
 *
 * 与索引 token 的差异：英文单词超过 PREFIX_LEN 时，查询侧只取前 PREFIX_LEN 字符，
 * 保证 `deploy` 能命中索引了 `deploying` 的文档（前缀语义）。
 * 中文侧与索引保持一致（单字 + 二元组）。
 */
export function queryTokens(input: string): string[] {
  const tokens = new Set<string>();
  const text = input.toLowerCase();

  let latin = '';
  let cjkRun = '';

  const flushLatin = () => {
    if (!latin) return;
    tokens.add(latin.length > PREFIX_LEN ? latin.slice(0, PREFIX_LEN) : latin);
    latin = '';
  };

  const flushCjk = () => {
    if (!cjkRun) return;
    for (let i = 0; i < cjkRun.length; i++) {
      tokens.add(cjkRun[i]);
      if (i + 1 < cjkRun.length) tokens.add(cjkRun.slice(i, i + 2));
    }
    cjkRun = '';
  };

  for (const ch of text) {
    if (CJK.test(ch)) {
      flushLatin();
      cjkRun += ch;
    } else if (/[a-z0-9_#@.+-]/.test(ch)) {
      flushCjk();
      latin += ch;
    } else {
      flushLatin();
      flushCjk();
    }
  }
  flushLatin();
  flushCjk();

  return [...tokens];
}

/** 把 Markdown 压缩成用于搜索与摘要的纯文本 */
export function toPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^::[\s\S]*$/gm, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 抽取正文中的 #标签 */
export function extractTags(markdown: string, plain: string): string[] {
  const fromHash = [...markdown.matchAll(/(?:^|\s)#([\p{L}\p{N}_\-]{1,32})/gu)].map((m) =>
    m[1].toLowerCase(),
  );
  const fromPlain = [...plain.matchAll(/(?:^|\s)#([\p{L}\p{N}_\-]{1,32})/gu)].map((m) =>
    m[1].toLowerCase(),
  );
  return [...new Set([...fromHash, ...fromPlain])].slice(0, 12);
}
