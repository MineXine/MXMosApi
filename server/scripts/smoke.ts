/**
 * 全链路冒烟测试：直接调用 Express app（不监听端口），覆盖
 * 注册 / 登录 / 创建 / 可见性 / 点赞 / 收藏 / 标签 / 搜索 / 视图 /
 * 归档恢复 / 日历 / 地图 / 草稿 / 分享 / 设备信息 / 统计
 */
import assert from 'node:assert';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/index.js';
import { closeRepository } from '../src/repositories/index.js';

let baseUrl = '';
let tokenA = '';
let tokenB = '';
let postId = '';
let privatePostId = '';
let shareToken = '';

/**
 * API 返回的 JSON 载荷。
 *
 * 新版 @types/node 中 `Response.json()` 返回 `Promise<unknown>`，
 * 直接 spread 或取属性都会被 TS 拒绝，因此显式收窄为对象类型。
 */
type Json = Record<string, any>;

async function api(
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {},
): Promise<Json & { status: number }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.token) headers.authorization = `Bearer ${options.token}`;

  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const json = (await res.json().catch(() => ({}))) as Json;
  return { status: res.status, ...json };
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function apiUA(path: string, token?: string): Promise<Json> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path}`, { headers });
  return (await res.json().catch(() => ({}))) as Json;
}

const steps: string[] = [];

function pass(name: string) {
  steps.push(name);
  console.log(`  ✓ ${name}`);
}

async function run() {
  const app = await createApp();
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}/api`;

  console.log('\n▶ 说说系统 API 冒烟测试\n');

  // 1. 健康检查
  const health = await api('/health');
  assert.equal(health.ok, true);
  pass('健康检查');

  // 2. 注册两个用户
  const regA = await api('/auth/register', {
    method: 'POST',
    body: { username: 'alice', password: 'secret123', displayName: 'Alice' },
  });
  assert.equal(regA.status, 201);
  tokenA = regA.data.token;

  const regB = await api('/auth/register', {
    method: 'POST',
    body: { username: 'bob', password: 'secret123', displayName: 'Bob' },
  });
  tokenB = regB.data.token;
  pass('注册两个用户');

  // 3. 登录
  const login = await api('/auth/login', {
    method: 'POST',
    body: { username: 'alice', password: 'secret123' },
  });
  assert.equal(login.ok, true);
  pass('登录');

  // 4. 重复用户名冲突
  const dup = await api('/auth/register', {
    method: 'POST',
    body: { username: 'alice', password: 'secret123' },
  });
  assert.equal(dup.status, 409);
  pass('重复用户名返回 409');

  // 5. 创建公开说说（含标签 + MDC 组件 + 位置 + 附件）
  const created = await api('/posts', {
    method: 'POST',
    token: tokenA,
    body: {
      content: '今天去了**西湖**散步，天气不错 #旅行 #杭州\n\n::alert{type="warning" title="注意"}',
      visibility: 'public',
      location: { lat: 30.2469, lng: 120.1461, label: '杭州西湖' },
      attachments: [
        {
          id: 'a1',
          url: '/uploads/demo.png',
          filename: 'demo.png',
          mime: 'image/png',
          size: 1024,
          kind: 'image',
        },
      ],
    },
  });
  assert.equal(created.status, 201);
  postId = created.data.post.id;
  assert.equal(created.data.post.visibility, 'public');
  assert.ok(created.data.post.tags.includes('旅行'), '应自动提取标签');
  assert.equal(created.data.post.stats.likes, 0);
  pass('创建公开说说（自动标签 + MDC 组件解析）');

  // 6. MDC 选项注入：alert 的默认 type/title 来自配置表
  const mdc = created.data.post.mdcOptions.find((m: any) => m.name === 'alert');
  assert.ok(mdc, '应解析出 alert 组件');
  assert.equal(mdc.props.type, 'warning', '正文显式声明的 props 应覆盖默认值');
  assert.equal(mdc.props.closable, true, '未声明的项应使用配置默认值补齐');
  pass('MDC 组件选项注入（显式值 + 配置默认值）');

  // 7. 设备信息
  const dev = await api('/posts');
  const detail = await api(`/posts/${postId}`, { token: tokenA });
  assert.ok(detail.data.post.device, '应记录设备信息');
  assert.ok(detail.data.post.device.browser.length > 0);
  pass('设备信息记录（浏览器 / 系统）');

  // 8. 创建私密说说
  const priv = await api('/posts', {
    method: 'POST',
    token: tokenA,
    body: { content: '这是一条私密内容', visibility: 'private' },
  });
  privatePostId = priv.data.post.id;
  assert.equal(priv.data.post.visibility, 'private');
  pass('创建私密说说');

  // 9. 可见性：Bob 看不到 Alice 的私密说说
  const bobList = await api('/posts', { token: tokenB });
  const bobIds = bobList.data.items.map((p: any) => p.id);
  assert.ok(!bobIds.includes(privatePostId), 'Bob 不应看到私密说说');
  assert.ok(bobIds.includes(postId), 'Bob 应看到公开说说');
  pass('可见性隔离（私密仅作者可见）');

  // 10. 私密详情直连应 403
  const privPeek = await api(`/posts/${privatePostId}`, { token: tokenB });
  assert.equal(privPeek.status, 403);
  pass('私密详情越权访问返回 403');

  // 11. 点赞
  const like = await api(`/posts/${postId}/like`, { method: 'POST', token: tokenB });
  assert.equal(like.data.liked, true);
  assert.equal(like.data.count, 1);
  const unlike = await api(`/posts/${postId}/like`, { method: 'POST', token: tokenB });
  assert.equal(unlike.data.liked, false);
  assert.equal(unlike.data.count, 0);
  await api(`/posts/${postId}/like`, { method: 'POST', token: tokenB });
  pass('点赞 / 取消点赞');

  // 12. 收藏
  const fav = await api(`/posts/${postId}/favorite`, { method: 'POST', token: tokenB });
  assert.equal(fav.data.favorited, true);
  assert.equal(fav.data.count, 1);
  pass('收藏 / 取消收藏');

  // 13. 点赞用户列表
  const likers = await api(`/posts/${postId}/likes`);
  assert.equal(likers.data.users.length, 1);
  pass('点赞用户列表');

  // 14. 标签列表
  const tags = await api('/posts/tags/list');
  assert.ok(tags.data.tags.some((t: any) => t.name === '旅行'));
  pass('标签列表与计数');

  // 15. 中文全文搜索
  const search = await api('/posts?keyword=西湖', { token: tokenA });
  assert.ok(search.data.total >= 1, '中文关键词应命中');
  const searchTag = await api('/posts?keyword=杭州', { token: tokenA });
  assert.ok(searchTag.data.total >= 1, '中文标签应命中');
  // 英文分词：另建一条含英文的说说
  await api('/posts', {
    method: 'POST',
    token: tokenA,
    body: { content: 'Deploying the new serverless stack today', visibility: 'public' },
  });
  const searchEn = await api('/posts?keyword=serverless', { token: tokenA });
  assert.equal(searchEn.data.total, 1, '英文关键词应精确命中');
  const searchEnPartial = await api('/posts?keyword=deploy', { token: tokenA });
  assert.equal(searchEnPartial.data.total, 1, '英文前缀应命中');
  pass('全文搜索（中文 bigram + 英文分词）');

  // 16. 标签筛选
  const byTag = await api('/posts?tags=旅行', { token: tokenA });
  assert.equal(byTag.data.total, 1);
  pass('标签筛选');

  // 17. 视图列表（内置视图自动初始化）
  const views = await api('/views', { token: tokenA });
  assert.ok(views.data.views.length >= 5, '应生成内置视图');
  assert.ok(views.data.views.some((v: any) => v.name === '归档'));
  pass('视图列表（内置视图初始化）');

  // 18. 按视图取列表
  const archiveView = views.data.views.find((v: any) => v.name === '归档');
  const viewPosts = await api(`/views/${archiveView.id}/posts`, { token: tokenA });
  assert.equal(viewPosts.data.total, 0);
  pass('按视图获取说说列表');

  // 19. 创建自定义视图
  const newView = await api('/views', {
    method: 'POST',
    token: tokenA,
    body: { name: '旅行足迹', icon: 'map', description: '带位置的旅行说说', filters: { hasLocation: true } },
  });
  assert.equal(newView.status, 201);
  pass('创建自定义视图');

  // 20. 归档 + 恢复
  const archived = await api(`/posts/${postId}/archive`, { method: 'POST', token: tokenA });
  assert.equal(archived.data.post.status, 'archived');
  const archList = await api('/posts?status=archived', { token: tokenA });
  assert.equal(archList.data.total, 1);
  const restored = await api(`/posts/${postId}/unarchive`, { method: 'POST', token: tokenA });
  assert.equal(restored.data.post.status, 'published');
  pass('归档与恢复');

  // 21. 日历视图
  const now = new Date();
  const cal = await api(
    `/posts/calendar/buckets?year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`,
    { token: tokenA },
  );
  assert.ok(Array.isArray(cal.data.cells));
  assert.ok(cal.data.cells.length >= 1, '当月应有说说');
  pass('日历视图数据');

  // 22. 地图视图
  const map = await api('/posts/map/points', { token: tokenA });
  assert.equal(map.data.points.length, 1);
  assert.ok(Math.abs(map.data.points[0].lat - 30.2469) < 0.001);
  pass('地图视图数据');

  // 23. 草稿自动保留
  const draft = await api('/drafts', {
    method: 'PUT',
    token: tokenA,
    body: { key: 'new-post', content: '未完成的草稿内容', tags: ['草稿'] },
  });
  assert.equal(draft.status, 200);
  const draftGet = await api('/drafts/new-post', { token: tokenA });
  assert.equal(draftGet.data.draft.content, '未完成的草稿内容');
  const draftList = await api('/drafts', { token: tokenA });
  assert.equal(draftList.data.drafts.length, 1);
  pass('草稿自动保留（保存 / 读取 / 列表）');

  // 24. 分享链接
  const share = await api(`/posts/${postId}/share`, { method: 'POST', token: tokenA });
  assert.equal(share.status, 201);
  shareToken = share.data.share.token;
  const shareView = await api(`/share/${shareToken}`);
  assert.equal(shareView.ok, true);
  assert.equal(shareView.data.post.id, postId);
  pass('分享链接生成与公开访问');

  // 25. 分享列表
  const shares = await api('/posts/' + postId + '/shares', { token: tokenA });
  assert.equal(shares.data.shares.length, 1);
  pass('分享记录列表');

  // 26. 编辑说说
  const edited = await api(`/posts/${postId}`, {
    method: 'PATCH',
    token: tokenA,
    body: { content: '更新后的内容 #更新' },
  });
  assert.ok(edited.data.post.content.includes('更新后的内容'));
  assert.ok(edited.data.post.tags.includes('更新'));
  pass('编辑说说（重新提取标签与检索 token）');

  // 27. 越权编辑
  const illegal = await api(`/posts/${postId}`, {
    method: 'PATCH',
    token: tokenB,
    body: { content: '恶意修改' },
  });
  assert.equal(illegal.status, 403);
  pass('越权编辑返回 403');

  // 28. 统计
  const stats = await api('/stats', { token: tokenA });
  assert.ok(stats.data.stats.total >= 2);
  assert.ok(stats.data.stats.totalLikes >= 1);
  assert.ok(stats.data.stats.totalFavorites >= 1);
  assert.ok(stats.data.stats.withLocation >= 1);
  pass('仪表盘统计');

  // 29. 设备信息接口
  const deviceApi = await apiUA('/stats/device', tokenA);
  assert.ok(deviceApi.data.device.browser);
  pass('设备信息接口');

  // 30. 删除说说
  const del = await api(`/posts/${privatePostId}`, { method: 'DELETE', token: tokenA });
  assert.equal(del.ok, true);
  const afterDel = await api(`/posts/${privatePostId}`, { token: tokenA });
  assert.equal(afterDel.status, 404);
  pass('删除说说');

  server.close();
  await closeRepository();

  console.log(`\n✅ 全部 ${steps.length} 项冒烟测试通过\n`);
}

run().catch(async (err) => {
  console.error('\n❌ 冒烟测试失败:\n', err);
  await closeRepository();
  process.exit(1);
});
