/** 端到端验证脚本：对运行中的真实 HTTP 服务造数据并校验各功能点 */
const B = process.env.API_BASE || 'http://localhost:4000/api';

/**
 * API 返回的 JSON 载荷。
 *
 * 新版 @types/node 中 `Response.json()` 返回 `Promise<unknown>`，
 * 直接 spread 或取属性都会被 TS 拒绝，因此显式收窄为对象类型。
 */
type Json = Record<string, any>;

interface ReqOptions {
  method?: string;
  body?: unknown;
  token?: string;
}

async function j(path: string, opts: ReqOptions = {}): Promise<Json & { status: number }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = await fetch(B + path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Json;
  return { status: res.status, ...json };
}

interface CheckItem {
  name: string;
  ok: boolean;
  extra: string;
}

const out: CheckItem[] = [];
const check = (name: string, cond: unknown, extra = ''): void => {
  out.push({ name, ok: !!cond, extra });
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

(async () => {
  console.log('\n▶ 端到端 HTTP 验证\n');

  const health = await j('/health');
  check('健康检查', health.ok);

  const reg = await j('/auth/register', {
    method: 'POST',
    body: { username: 'demo', password: 'demo123', displayName: '演示用户' },
  });
  // 用户已存在时直接登录，保证脚本可重复执行
  let t: string;
  if (reg.status === 201) {
    t = reg.data.token;
  } else {
    const li = await j('/auth/login', {
      method: 'POST',
      body: { username: 'demo', password: 'demo123' },
    });
    if (!li.data?.token) throw new Error(`登录失败: ${JSON.stringify(li)}`);
    t = li.data.token;
  }
  check('注册/登录用户', !!t);

  // 清理该用户历史数据，保证断言可重复执行
  const stale = await j('/posts?pageSize=100', { token: t });
  for (const p of stale.data.items as Array<{ id: string }>) {
    await j(`/posts/${p.id}`, { method: 'DELETE', token: t });
  }

  const p1 = await j('/posts', {
    method: 'POST',
    token: t,
    body: {
      content:
        '今天天气不错，去**西湖**散步了 #旅行 #杭州\n\n::alert{type="warning" title="注意"}\n记得带伞\n::',
      location: { lat: 30.2469, lng: 120.1461, label: '杭州西湖' },
    },
  });
  check('创建说说', p1.status === 201);
  check('自动提取标签', p1.data.post.tags.includes('旅行') && p1.data.post.tags.includes('杭州'));

  const mdc = (p1.data.post.mdcOptions || []).find(
    (m: { name: string }) => m.name === 'alert',
  );
  check('MDC 组件解析', !!mdc, mdc ? `props=${JSON.stringify(mdc.props)}` : '');
  check('MDC 选项注入（显式+默认）', mdc && mdc.props.type === 'warning' && mdc.props.closable === true);

  const p2 = await j('/posts', {
    method: 'POST',
    token: t,
    body: { content: '这是一条**私密**内容', visibility: 'private' },
  });
  check('创建私密说说', p2.data.post.visibility === 'private');

  await j('/posts', {
    method: 'POST',
    token: t,
    body: {
      content: 'Deploying serverless architecture notes',
      location: { lat: 31.2304, lng: 121.4737, label: '上海' },
    },
  });

  const list = await j('/posts', { token: t });
  check('时间线列表', list.data.total === 3, `total=${list.data.total}`);

  const tags = await j('/posts/tags/list');
  check(
    '标签统计',
    tags.data.tags.some((x: { name: string; count: number }) => x.name === '旅行' && x.count === 1),
  );

  const cn = await j('/posts?keyword=' + encodeURIComponent('西湖'), { token: t });
  check('中文全文搜索', cn.data.total === 1, `hits=${cn.data.total}`);

  const en = await j('/posts?keyword=serverless', { token: t });
  check('英文全文搜索', en.data.total === 1, `hits=${en.data.total}`);

  const views = await j('/views', { token: t });
  check(
    '内置视图初始化',
    views.data.views.length >= 5,
    views.data.views.map((v: { name: string }) => v.name).join('/'),
  );

  const map = await j('/posts/map/points', { token: t });
  check('地图点位', map.data.points.length === 2, `points=${map.data.points.length}`);

  const cal = await j(
    `/posts/calendar/buckets?year=${new Date().getFullYear()}&month=${new Date().getMonth() + 1}`,
    { token: t },
  );
  check('日历分桶', cal.data.cells.length >= 1);

  const like = await j(`/posts/${p1.data.post.id}/like`, { method: 'POST', token: t });
  check('点赞', like.data.liked === true && like.data.count === 1);

  const fav = await j(`/posts/${p1.data.post.id}/favorite`, { method: 'POST', token: t });
  check('收藏', fav.data.favorited === true);

  const favList = await j('/posts?favorited=true', { token: t });
  check('收藏列表', favList.data.total === 1);

  const share = await j(`/posts/${p1.data.post.id}/share`, { method: 'POST', token: t });
  check('生成分享链接', share.status === 201 && !!share.data.share.token);

  const shareView = await j(`/share/${share.data.share.token}`);
  check('分享链接公开访问', shareView.ok && shareView.data.post.id === p1.data.post.id);

  const draft = await j('/drafts', {
    method: 'PUT',
    token: t,
    body: { key: 'new-post', content: '草稿内容' },
  });
  check('草稿保存', draft.ok && draft.data.draft.content === '草稿内容');

  const arch = await j(`/posts/${p1.data.post.id}/archive`, { method: 'POST', token: t });
  check('封存', arch.data.post.status === 'archived');
  const archList = await j('/posts?status=archived', { token: t });
  check('封存列表', archList.data.total === 1);
  const un = await j(`/posts/${p1.data.post.id}/unarchive`, { method: 'POST', token: t });
  check('恢复', un.data.post.status === 'published');

  const stats = await j('/stats', { token: t });
  check('统计', stats.data.stats.total === 3 && stats.data.stats.totalLikes === 1);

  const device = await j('/stats/device', { token: t });
  check('设备信息', !!device.data.device.browser);

  // 可见性隔离：另注册用户验证
  const reg2 = await j('/auth/register', {
    method: 'POST',
    body: { username: 'observer', password: 'demo123' },
  });
  let t2: string;
  if (reg2.status === 201) {
    t2 = reg2.data.token;
  } else {
    const li2 = await j('/auth/login', {
      method: 'POST',
      body: { username: 'observer', password: 'demo123' },
    });
    t2 = li2.data?.token ?? '';
  }
  const otherList = await j('/posts', { token: t2 });
  const otherIds = (otherList.data.items as Array<{ id: string }>).map((p) => p.id);
  check(
    '可见性隔离（私密不可见）',
    !otherIds.includes(p2.data.post.id) && otherIds.includes(p1.data.post.id),
    `visible=${otherIds.length}`,
  );
  const peek = await j(`/posts/${p2.data.post.id}`, { token: t2 });
  check('私密直连返回 403', peek.status === 403);

  const failed = out.filter((x) => !x.ok);
  console.log(`\n${failed.length === 0 ? '✅' : '❌'} ${out.length - failed.length}/${out.length} 项通过\n`);
  process.exit(failed.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error('验证脚本异常:', e);
  process.exit(1);
});
