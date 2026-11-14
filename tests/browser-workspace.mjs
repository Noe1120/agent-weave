import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = resolve(".");
const output = resolve(process.env.UI_EVIDENCE || ".runtime/browser-evidence");
await mkdir(output, { recursive: true });
const temp = await mkdtemp(join(tmpdir(), "team-browser-"));
const db = join(temp, "synthetic.sqlite");
let server,
  browser,
  context,
  page,
  port,
  code,
  stderr = "";
const checks = [],
  pageErrors = [],
  responses = [],
  consoleErrors = [];
async function start(wantedPort = 0) {
  let stdout = "";
  server = spawn(process.execPath, ["dist/packages/service/src/main.js"], {
    cwd: root,
    windowsHide: true,
    env: { ...process.env, CORE_DB: db, PORT: String(wantedPort) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (b) => (stdout += b.toString()));
  server.stderr.on("data", (b) => (stderr += b.toString()));
  await new Promise((done, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Local service startup timed out")),
      10000,
    );
    server.stdout.on("data", () => {
      if (stdout.includes("一次性配对码")) {
        clearTimeout(timer);
        done();
      }
    });
    server.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    server.once("exit", (status) => {
      clearTimeout(timer);
      reject(new Error("Server exited: " + status));
    });
  });
  port = JSON.parse(stdout.split("\n")[0]).port;
  code = stdout.match(/：([A-Za-z0-9_-]{43})/)[1];
}
async function stop() {
  if (server && server.exitCode === null) {
    await new Promise((resolve) => {
      server.once("exit", resolve);
      server.kill();
    });
  }
}
async function visible(selector) {
  await page.locator(selector).waitFor({ state: "visible" });
}
async function hidden(selector) {
  await page.locator(selector).waitFor({ state: "hidden" });
}
async function text(selector, expected) {
  await page.waitForFunction(
    ({ selector, expected }) =>
      document.querySelector(selector)?.innerText.includes(expected),
    { selector, expected },
  );
}
function pass(name) {
  checks.push({ name, result: "PASS" });
  console.log("PASS " + name);
}
async function saveDialog() {
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await hidden("#editor");
}
async function project(name) {
  await page.locator("#new-project").click();
  await page.getByLabel("项目群名称", { exact: true }).fill(name);
  await page
    .getByLabel("项目目标 / 说明", { exact: true })
    .fill("合成数据 · 无真实执行、无外发");
  await saveDialog();
  await text("#project-title", name);
}
async function message(body, recipient = "public") {
  await page.locator("#recipient").selectOption(recipient);
  await page.locator("#message-body").fill(body);
  await page.locator("#send-message").click();
  await text("#message-list", body);
  await page.waitForFunction(
    () => document.querySelector("#message-body").value === "",
  );
}
async function screenshot(name) {
  await page.screenshot({
    path: join(output, name + ".png"),
    fullPage: true,
    mask: [page.locator("#pair-code")],
  });
}
try {
  await start();
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: "zh-CN",
  });
  page = await context.newPage();
  page.setDefaultTimeout(7000);
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("response", (r) => {
    if (r.status() >= 400)
      responses.push({ path: new URL(r.url()).pathname, status: r.status() });
  });
  await page.goto("http://127.0.0.1:" + port);
  await visible("#login");
  assert.equal(await page.locator("#pair-error").isVisible(), false);
  await page.locator("#pair-code").fill("x".repeat(43));
  await page.getByRole("button", { name: "进入工作台" }).click();
  await text("#pair-error", "配对码无效");
  assert.equal(await page.locator("#pair-code").inputValue(), "x".repeat(43));
  pass("invalid pairing displays error and retains input");
  await page.locator("#pair-code").fill(code);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await visible("#workspace");
  await visible("#welcome");
  pass("first pairing reaches empty owner workspace");
  await project("协作平台 · 用户走查");
  const firstProject = await page
    .locator(".project-button.active")
    .getAttribute("aria-label");
  pass("create project persists and opens real workspace");
  for (const m of [
    { client: "codex", name: "Codex", role: "本地实现与测试" },
    { client: "claude_desktop", name: "Claude Desktop", role: "需求审阅" },
    { client: "deepseek_harness", name: "DeepSeek Harness", role: "资料整理" },
  ]) {
    await page.locator("#add-member").click();
    await page.getByLabel("原客户端", { exact: true }).selectOption(m.client);
    await page.getByLabel("显示名称", { exact: true }).fill(m.name);
    await page.getByLabel("职责", { exact: true }).fill(m.role);
    await saveDialog();
    await text("#member-list", m.name + " · 未连接");
  }
  assert.equal(await page.locator(".member").count(), 3);
  await text("#progress", "0");
  pass("all three specified identities remain explicitly disconnected");
  const codex = page.locator('.member[data-client="codex"]');
  await codex.getByRole("button", { name: "编辑职责" }).click();
  await page.getByLabel("职责", { exact: true }).fill("实现、回归与根因分析");
  await saveDialog();
  await text("#member-list", "实现、回归与根因分析");
  pass("edit member role without changing original client identity");
  await page.locator("#add-member").click();
  await page.getByLabel("显示名称", { exact: true }).fill("Codex");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await text("#editor-error", "同名成员");
  assert.equal(
    await page.getByLabel("显示名称", { exact: true }).inputValue(),
    "Codex",
  );
  await page.locator("#editor-cancel").click();
  pass("duplicate member rejection is visible and input-preserving");
  await message("项目目标：完成离线协作工作台，区分本地保存与真实发送。");
  const recipient = await page
    .locator("#recipient option")
    .filter({ hasText: "@ Codex" })
    .getAttribute("value");
  const literal = '<img src=x onerror="window.__xss=1"> 私密 100%_!';
  await message(literal, recipient);
  assert.equal(await page.locator("#message-list img").count(), 0);
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  await text("#message-list", "定向 · Codex");
  await text("#message-list", "原客户端尚未接收");
  pass(
    "public/directed messages persist; HTML displays literally without executing",
  );
  await page.locator("#search-input").fill("100%_!");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await text("#search-status", "1 条结果");
  assert.equal(await page.locator(".message").count(), 1);
  await page.locator("#clear-search").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".message").length === 2,
  );
  pass("literal wildcard search and return to full history");
  await page.locator("#tab-tasks").click();
  await page.locator("#new-task").click();
  await page.getByLabel("任务标题", { exact: true }).fill("离线工作台验收草稿");
  await page.getByLabel("计划负责人", { exact: true }).selectOption(recipient);
  await page
    .getByLabel("任务描述", { exact: true })
    .fill("验证消息隔离、错误恢复和数据持久化。");
  await page
    .getByLabel("验收草案", { exact: true })
    .fill("每一步保留可复核证据；不伪造 Agent 执行。");
  await saveDialog();
  await text("#task-list", "离线工作台验收草稿");
  await page.getByRole("button", { name: "编辑草稿", exact: true }).click();
  await page
    .getByLabel("任务标题", { exact: true })
    .fill("离线工作台验收草稿 v2");
  await saveDialog();
  await text("#task-list", "v2");
  await page.getByRole("button", { name: "归档", exact: true }).click();
  await text("#task-list", "已归档");
  await page.getByRole("button", { name: "恢复草稿", exact: true }).click();
  await text("#task-list", "草稿 · 未派送");
  pass(
    "create edit archive restore drafts without claiming execution or confirmed acceptance",
  );
  await screenshot("desktop-tasks");
  await page.locator("#tab-chat").click();
  await page.locator("#message-body").fill("只属于第一个群的未发送私密草稿");
  await project("隔离对照群");
  await page.locator("#tab-chat").click();
  assert.equal(await page.locator(".message").count(), 0);
  assert.equal(await page.locator("#message-body").inputValue(), "");
  await message("第二群公开消息");
  await page.getByRole("button", { name: firstProject, exact: true }).click();
  await text("#project-title", "协作平台 · 用户走查");
  assert.equal(
    await page.locator("#message-body").inputValue(),
    "只属于第一个群的未发送私密草稿",
  );
  assert.equal(await page.locator("#recipient").inputValue(), recipient);
  assert.ok(
    !(await page.locator("#message-list").innerText()).includes(
      "第二群公开消息",
    ),
  );
  pass(
    "project switch isolates persisted history and restores scoped unsent draft",
  );
  await codex.getByRole("button", { name: "停用成员" }).click();
  await text("#member-list", "Codex · 已停用");
  await text("#audience-hint", "不会自动改为公开");
  assert.equal(await page.locator("#send-message").isDisabled(), true);
  assert.equal(await page.locator("#recipient").inputValue(), recipient);
  pass(
    "disabled recipient blocks sending; private draft never falls back to public",
  );
  await page.locator("#tab-tasks").click();
  await page.getByRole("button", { name: "编辑草稿", exact: true }).click();
  await page
    .getByLabel("任务标题", { exact: true })
    .fill("停用负责人不应被静默清空");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await visible("#editor-error");
  await text("#editor-error", "负责人");
  assert.equal(await page.locator("#editor").isVisible(), true);
  await page.getByLabel("计划负责人", { exact: true }).selectOption("");
  await saveDialog();
  await text("#task-list", "计划负责人：待分配");
  pass(
    "inactive draft assignee requires explicit reassignment rather than silent clearing",
  );
  await codex.getByRole("button", { name: "重新启用" }).click();
  await text("#member-list", "Codex · 未连接");
  await page.locator("#tab-chat").click();
  assert.equal(await page.locator("#send-message").isEnabled(), true);
  await message("重新启用后仍只是本地保存", recipient);
  pass("re-enable member does not pretend to connect a client");
  await page.reload();
  await text("#message-list", literal);
  await text("#member-list", "实现、回归与根因分析");
  pass("browser refresh retains committed data and owner session");
  const beforeReads = await page.locator(".message").count();
  await page.locator("#refresh").click();
  await text("#toast", "没有打断任务");
  assert.equal(await page.locator(".message").count(), beforeReads);
  pass("read-only progress refresh creates no messages or fake execution");
  await screenshot("desktop-messages");
  await page.locator("#tab-tasks").click();
  await page.getByRole("button", { name: "编辑草稿", exact: true }).click();
  await page.getByLabel("任务标题", { exact: true }).fill("我的未提交版本");
  const other = await context.newPage();
  other.setDefaultTimeout(7000);
  await other.goto("http://127.0.0.1:" + port);
  await other.getByRole("button", { name: firstProject, exact: true }).click();
  await other.locator("#tab-tasks").click();
  await other.getByRole("button", { name: "编辑草稿", exact: true }).click();
  await other.getByLabel("任务标题", { exact: true }).fill("另一个窗口的版本");
  await other.getByRole("button", { name: "保存", exact: true }).click();
  await other.locator("#editor").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await text("#editor-error", "其他窗口更新");
  assert.equal(
    await page.getByLabel("任务标题", { exact: true }).inputValue(),
    "我的未提交版本",
  );
  await page.locator("#editor-cancel").click();
  await other.close();
  await page.locator("#refresh").click();
  await text("#task-list", "另一个窗口的版本");
  pass(
    "concurrent draft edit rejects stale revision and preserves unsaved input",
  );
  await page.locator("#tab-chat").click();
  await page.route("**/v1/console/commands", async (route) => {
    await route.fetch();
    await route.abort("failed");
  });
  await page.locator("#message-body").fill("提交成功但回执丢失的消息");
  await page.locator("#send-message").click();
  await text("#compose-error", "无法连接");
  assert.equal(
    await page.locator("#message-body").inputValue(),
    "提交成功但回执丢失的消息",
  );
  await page.unroute("**/v1/console/commands");
  await page.locator("#send-message").click();
  await text("#message-list", "提交成功但回执丢失的消息");
  assert.equal(
    await page
      .locator(".message-body")
      .filter({ hasText: "提交成功但回执丢失的消息" })
      .count(),
    1,
  );
  pass(
    "lost commit response reuses action id; retry never duplicates the message",
  );
  // Network failures are injected at the browser boundary, never hidden or accepted as successes.
  await page.route("**/v1/console/projects/*", (route) =>
    route.request().method() === "GET"
      ? route.abort("failed")
      : route.continue(),
  );
  await page
    .getByRole("button", { name: "打开项目群 隔离对照群", exact: true })
    .click();
  await text("#toast", "无法连接");
  assert.equal(
    await page.locator("#project-view").isVisible(),
    false,
    "failed project load must not leave old project controls bound to new target",
  );
  pass("failed project switch cannot expose stale writable controls");
  await page.unroute("**/v1/console/projects/*");
  await page
    .getByRole("button", { name: "打开项目群 隔离对照群", exact: true })
    .click();
  await text("#project-title", "隔离对照群");
  await page.route("**/v1/console/projects", (route) =>
    route.request().method() === "GET"
      ? route.abort("failed")
      : route.continue(),
  );
  await page.locator("#new-project").click();
  await page
    .getByLabel("项目群名称", { exact: true })
    .fill("保存成功但刷新故障");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await hidden("#editor");
  await text("#toast", "已创建");
  await text("#toast", "刷新失败");
  pass("committed project with failed refresh reports both outcomes visibly");
  await page.unroute("**/v1/console/projects");
  await page.reload();
  await page
    .getByRole("button", { name: "打开项目群 保存成功但刷新故障", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", {
        name: "打开项目群 保存成功但刷新故障",
        exact: true,
      })
      .count(),
    1,
  );
  await page.getByRole("button", { name: firstProject, exact: true }).click();
  await text("#project-title", "协作平台 · 用户走查");
  // Generate enough history through UI to exercise actual paging, not an API replacement.
  const initialHistoryCount = await page.locator(".message").count();
  for (let i = 1; i <= 51; i++)
    await message("分页消息 " + String(i).padStart(2, "0"));
  await visible("#older-messages");
  assert.equal(await page.locator(".message").count(), 50);
  await page.locator("#older-messages").click();
  await text("#message-list", literal);
  assert.equal(
    await page.locator(".message").count(),
    initialHistoryCount + 51,
  );
  pass("50-item history boundary loads older messages without duplicates");
  await page.locator("#message-body").fill("网络失败后仍应保留的草稿");
  await stop();
  await page.locator("#send-message").click();
  await text("#compose-error", "无法连接");
  assert.equal(
    await page.locator("#message-body").inputValue(),
    "网络失败后仍应保留的草稿",
  );
  await start(port);
  await page.locator("#send-message").click();
  await text("#message-list", "网络失败后仍应保留的草稿");
  assert.equal(
    await page
      .locator(".message-body")
      .filter({ hasText: "网络失败后仍应保留的草稿" })
      .count(),
    1,
  );
  pass(
    "service restart preserves session/database; failed send retains input and retry creates one message",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await screenshot("mobile-messages");
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    "mobile layout must not horizontally overflow",
  );
  await page.locator("#logout").click();
  await visible("#login");
  pass("mobile layout has no horizontal overflow and logout remains reachable");
  await page.reload();
  await visible("#login");
  const pair = spawnSync(
    process.execPath,
    ["dist/packages/service/src/pair.js"],
    {
      cwd: root,
      env: { ...process.env, CORE_DB: db },
      encoding: "utf8",
      windowsHide: true,
    },
  );
  assert.equal(pair.status, 0);
  const newCode = pair.stdout.match(/[A-Za-z0-9_-]{43}/)[0];
  await page.locator("#pair-code").fill(newCode);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await visible("#workspace");
  await page.getByRole("button", { name: firstProject, exact: true }).click();
  await text("#message-list", "网络失败后仍应保留的草稿");
  pass(
    "logout revokes session; fresh local pairing restores persisted workspace",
  );
  await page.route("**/v1/console/projects", (route) => route.abort("failed"));
  await page.reload();
  await visible("#workspace");
  await visible("#toast");
  await text("#toast", "无法连接");
  pass(
    "session restoration read failure is visible outside the hidden login panel",
  );
  await page.unroute("**/v1/console/projects");
  await page.reload();
  await text("#message-list", "网络失败后仍应保留的草稿");
  assert.deepEqual(
    responses.filter((r) => ![401, 409].includes(r.status)),
    [],
    "unexpected HTTP error",
  );
  assert.deepEqual(
    consoleErrors.filter(
      (m) => !/(?:401|409|net::ERR_FAILED|net::ERR_CONNECTION_REFUSED)/.test(m),
    ),
    [],
    "unexpected browser console error",
  );
  assert.deepEqual(pageErrors, []);
  pass("no uncaught browser exceptions");
  const activeBox = await page.locator(".project-button.active").boundingBox();
  assert.ok(
    activeBox && activeBox.x >= 0 && activeBox.x + activeBox.width <= 390,
    "selected project must remain visible in mobile navigation after rerender",
  );
  pass("mobile project navigation keeps selected group fully visible");
  await screenshot("mobile-final");
} catch (error) {
  checks.push({
    name: "walkthrough failure",
    result: "FAIL",
    error: error.message,
  });
  if (page)
    await screenshot("failure").catch((e) => {
      checks.push({
        name: "failure screenshot",
        result: "FAIL",
        error: e.message,
      });
      console.error(e);
    });
  console.error(error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await stop();
  await writeFile(
    join(output, "browser-report.json"),
    JSON.stringify(
      {
        mode: "INDEPENDENT_HEADLESS_CHROMIUM_SYNTHETIC_UI",
        checks,
        pageErrors,
        consoleErrors,
        responses,
        browser_version: browser?.version(),
        browser_closed: browser ? !browser.isConnected() : true,
        serverDiagnostics: stderr.replace(/[A-Za-z0-9_-]{43}/g, "[REDACTED]"),
        native_clients_started: 0,
        model_calls: 0,
        services_stopped:
          server?.exitCode !== null || server?.signalCode !== null,
        product_acceptance: "NOT_RUN",
      },
      null,
      2,
    ),
  );
  // temp is a newly created path from mkdtemp, never a user-selected directory.
  if (resolve(temp).startsWith(resolve(tmpdir()) + "\\"))
    await rm(temp, { recursive: true, force: true });
}
