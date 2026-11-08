/**
 * 开放 API 能力测试：覆盖从 kkapi-open 对照补齐的接口。
 *
 * 包括 API Token 全生命周期、开放发布、状态流转、标签管理、
 * 修改密码、通知渠道 CRUD、版本自描述。
 */
import assert from 'node:assert';
import { createApp } from '../src/index.js';
import { closeRepository } from '../src/repositories/index.js';

type Json = Record<string, any>;

let baseUrl = '';
let tokenA = '';

async function api(
  path: string,
  options: { method?: string; body?: unknown; token?: string; apiToken?: string } = {},
): Promise<Json & { status: number }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.apiToken) headers['x-api-token'] = options.apiToken;

  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const json = (await res.json().catch(() => ({}))) as Json;
  return { status: res.status, ...json };
}

const steps: string[] = [];

function pass(name: string) {
  steps.push(name);
  console.log(`  ✓ ${name}`);
}

async function run() {
  const app = await createApp();
  const server = app.listen(0);
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}/api`;

  console.log('\n▶ 开放 API 能力测试\n');

  // ---------- 0. 版本自描述 ----------
  const ver = await api('/version');
  assert.equal(ver.status, 200);
  assert.equal(ver.data.name, 'MXMosApi');
  assert.equal(ver.data.capabilities.apiToken, true);
  assert.equal(ver.data.capabilities.openPublish, true);
  assert.equal(ver.data.capabilities.notice, true);
  assert.equal(ver.data.capabilities.postStatus, true);
  assert.equal(ver.data.capabilities.tagManagement, true);
  pass('版本与能力自描述');

  // ---------- 准备账号 ----------
  await api('/auth/register', {
    method: 'POST',
    body: { username: 'openapi_user', password: 'demo123', displayName: '开放API用户' },
  });
  const li = await api('/auth/login', {
    method: 'POST',
    body: { username: 'openapi_user', password: 'demo123' },
  });
  tokenA = li.data.token;
  assert.ok(tokenA, '登录应返回 token');
  pass('账号准备');

  // ---------- 1. API Token 全生命周期 ----------
  const tkCreate = await api('/tokens', {
    method: 'POST',
    token: tokenA,
    body: { name: '我的脚本', scopes: ['posts:write'] },
  });
  assert.equal(tkCreate.status, 201);
  const plainToken: string = tkCreate.data.token;
  assert.ok(plainToken.startsWith('mx_'), 'token 应以 mx_ 开头');
  assert.equal(tkCreate.data.warning.includes('不会再次显示'), true);
  pass('创建 API Token（明文仅返回一次）');

  const tkList = await api('/tokens', { token: tokenA });
  assert.equal(tkList.status, 200);
  assert.equal(tkList.data.total, 1);
  // 列表里必须是掩码，不能是明文
  assert.equal(tkList.data.tokens[0].token.includes(plainToken), false);
  assert.equal(tkList.data.tokens[0].token.startsWith('mx_'), true);
  pass('令牌列表返回掩码而非明文');

  const tkId = tkCreate.data.id;

  // ---------- 2. 开放发布 ----------
  const pub = await api('/posts/by-token', {
    method: 'POST',
    apiToken: plainToken,
    body: { content: '通过 API Token 发布的第一条说说 #开放API' },
  });
  assert.equal(pub.status, 201);
  // 标签按设计统一小写（#开放API → 开放api）
  assert.equal(pub.data.post.tags.includes('开放api'), true);
  const openPostId = pub.data.post.id;
  pass('API Token 开放发布');

  // 无效 token 应被拒
  const badPub = await api('/posts/by-token', {
    method: 'POST',
    apiToken: 'mx_invalid_token',
    body: { content: '这条应该失败' },
  });
  assert.equal(badPub.status, 401);
  pass('无效 Token 被拒（401）');

  // 停用后拒绝
  await api(`/tokens/${tkId}`, { method: 'PATCH', token: tokenA, body: { enabled: false } });
  const disabledPub = await api('/posts/by-token', {
    method: 'POST',
    apiToken: plainToken,
    body: { content: '停用后应失败' },
  });
  assert.equal(disabledPub.status, 401);
  pass('停用令牌后拒绝开放发布');
  await api(`/tokens/${tkId}`, { method: 'PATCH', token: tokenA, body: { enabled: true } });

  // ---------- 3. 状态流转 ----------
  const st1 = await api(`/posts/${openPostId}/status`, {
    method: 'PATCH',
    token: tokenA,
    body: { status: 'hidden' },
  });
  assert.equal(st1.status, 200);
  assert.equal(st1.data.post.status, 'hidden');
  pass('状态流转到 hidden');

  // hidden 不出现在默认列表
  const defList = await api('/posts', { token: tokenA });
  assert.equal(defList.data.items.some((p: Json) => p.id === openPostId), false);
  pass('hidden 状态不进默认列表');

  // 但 status=hidden 可查
  const hidList = await api('/posts?status=hidden', { token: tokenA });
  assert.equal(hidList.data.items.some((p: Json) => p.id === openPostId), true);
  pass('按 hidden 状态可检索');

  await api(`/posts/${openPostId}/status`, {
    method: 'PATCH',
    token: tokenA,
    body: { status: 'published' },
  });
  pass('状态流转回 published');

  // ---------- 4. 标签管理 ----------
  const beforeTags = await api('/posts/tags/list', { token: tokenA });
  assert.ok(beforeTags.data.tags.some((t: Json) => t.name === '开放api'));

  const ren = await api('/posts/tags/rename', {
    method: 'POST',
    token: tokenA,
    body: { from: '开放api', to: 'openapi' },
  });
  assert.equal(ren.status, 200);
  assert.equal(ren.data.renamed, 1);
  assert.ok(ren.data.tags.some((t: Json) => t.name === 'openapi'));
  assert.equal(ren.data.tags.some((t: Json) => t.name === '开放api'), false);
  pass('标签改名');

  // 改成已存在的标签应自动去重（不产生重复）
  await api('/posts', {
    method: 'POST',
    token: tokenA,
    body: { content: '带 openapi 与合并测试 #openapi #合并测试' },
  });
  const ren2 = await api('/posts/tags/rename', {
    method: 'POST',
    token: tokenA,
    body: { from: '合并测试', to: 'openapi' },
  });
  assert.equal(ren2.status, 200);
  const afterMerge = await api('/posts?tags=openapi', { token: tokenA });
  for (const p of afterMerge.data.items as Json[]) {
    const occurrences = p.tags.filter((t: string) => t === 'openapi').length;
    assert.equal(occurrences, 1, '合并后不应出现重复标签');
  }
  pass('标签合并去重');

  const del = await api('/posts/tags/合并测试', { method: 'DELETE', token: tokenA });
  assert.equal(del.status, 200);
  pass('标签删除（说说本身不受影响）');

  // ---------- 5. 修改密码 ----------
  const badPwd = await api('/auth/password', {
    method: 'PATCH',
    token: tokenA,
    body: { oldPassword: 'wrong', newPassword: 'newpass123' },
  });
  assert.equal(badPwd.status, 401);
  pass('旧密码错误被拒');

  const okPwd = await api('/auth/password', {
    method: 'PATCH',
    token: tokenA,
    body: { oldPassword: 'demo123', newPassword: 'newpass123' },
  });
  assert.equal(okPwd.status, 200);
  pass('修改密码');

  // 新密码可登录
  const relogin = await api('/auth/login', {
    method: 'POST',
    body: { username: 'openapi_user', password: 'newpass123' },
  });
  assert.equal(relogin.status, 200);
  pass('新密码登录成功');

  // ---------- 6. 通知渠道 ----------
  const ncCreate = await api('/notice', {
    method: 'POST',
    token: tokenA,
    body: { type: 'webhook', token: 'http://127.0.0.1:1/hook', title: '测试渠道' },
  });
  assert.equal(ncCreate.status, 201);
  assert.equal(ncCreate.data.notice.type, 'webhook');
  // token 脱敏
  assert.equal(ncCreate.data.notice.token.startsWith('****'), true);
  pass('创建通知渠道（token 脱敏）');

  const ncList = await api('/notice', { token: tokenA });
  assert.equal(ncList.data.total, 1);
  pass('通知渠道列表');

  const ncTypes = await api('/notice/types');
  assert.equal(ncTypes.status, 200);
  assert.equal(ncTypes.data.types.length, 11);
  assert.ok(ncTypes.data.types.includes('telegram'));
  assert.ok(ncTypes.data.types.includes('wecom'));
  assert.ok(ncTypes.data.types.includes('dingtalk'));
  assert.ok(ncTypes.data.types.includes('bark'));
  pass('支持 11 种推送渠道');

  // 测试推送（本地地址不可达，应返回 sent:false 但不抛错）
  const ncTest = await api(`/notice/${ncCreate.data.notice.id}/test`, {
    method: 'POST',
    token: tokenA,
    body: { title: '测试', content: '测试内容' },
  });
  assert.equal(ncTest.status, 200);
  assert.equal(ncTest.data.sent, false);
  assert.ok(ncTest.data.error);
  pass('渠道测试返回真实结果（失败不抛异常）');

  // 校验非法渠道类型被拒（schema 校验失败统一返回 422）
  const badType = await api('/notice', {
    method: 'POST',
    token: tokenA,
    body: { type: 'nonsense', token: 'x' },
  });
  assert.equal(badType.status, 422);
  pass('非法渠道类型被拒（422）');

  // 更新 / 删除
  const ncUpd = await api(`/notice/${ncCreate.data.notice.id}`, {
    method: 'PATCH',
    token: tokenA,
    body: { enabled: false },
  });
  assert.equal(ncUpd.status, 200);
  assert.equal(ncUpd.data.notice.enabled, false);
  pass('更新通知渠道');

  const ncDel = await api(`/notice/${ncCreate.data.notice.id}`, {
    method: 'DELETE',
    token: tokenA,
  });
  assert.equal(ncDel.status, 200);
  pass('删除通知渠道');

  // ---------- 7. Token 吊销 ----------
  const tkDel = await api(`/tokens/${tkId}`, { method: 'DELETE', token: tokenA });
  assert.equal(tkDel.status, 200);
  const revokedPub = await api('/posts/by-token', {
    method: 'POST',
    apiToken: plainToken,
    body: { content: '吊销后应失败' },
  });
  assert.equal(revokedPub.status, 401);
  pass('令牌吊销后立即失效');

  server.close();
  await closeRepository();

  console.log(`\n✅ 全部 ${steps.length} 项开放 API 能力测试通过\n`);
}

run().catch(async (err) => {
  console.error('\n❌ 开放 API 能力测试失败:\n', err);
  await closeRepository();
  process.exit(1);
});
