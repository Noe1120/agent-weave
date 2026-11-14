const $ = (id) => document.getElementById(id);
const clients = {
  codex: "Codex",
  claude_desktop: "Claude Desktop",
  deepseek_harness: "DeepSeek Harness",
};
const state = {
  csrf: null,
  projects: [],
  selected: null,
  view: null,
  tab: "chat",
  query: "",
  messages: [],
  before: null,
  loadVersion: 0,
};
const drafts = new Map(),
  pending = new Map();
let toastTimer,
  editorSubmit = null,
  editorBusy = false;
const errors = {
  PAIRING_INVALID: "配对码无效、已使用或已过期。请运行 npm run pair 获取新码。",
  RATE_LIMITED: "尝试次数过多，请等待一分钟后再试。",
  SESSION_REQUIRED: "会话已过期，请重新配对。未发送内容仍在当前页面内存中。",
  CSRF_REJECTED: "会话校验失败，请重新配对后重试。",
  ORIGIN_REJECTED: "请求来源不受信任，请使用终端显示的本机地址。",
  INVALID_REQUEST: "填写内容不符合要求，请检查必填项、长度和接收范围。",
  BAD_REQUEST: "请求格式不正确，请检查输入后重试。",
  MEMBER_INACTIVE: "该成员已停用。消息没有保存，请重新选择有效接收范围。",
  MEMBER_NAME_EXISTS: "本群已有同名成员，请使用不同的显示名称。",
  REVISION_CONFLICT:
    "内容已被其他窗口更新。本次输入未清空；请取消并刷新后核对，不会覆盖新版本。",
  ACTION_PAYLOAD_CONFLICT: "该请求的内容与已有操作冲突。请核对保存结果后重试。",
  DRAFT_ARCHIVED: "任务已归档，请恢复草稿后再编辑。",
  NOT_FOUND_OR_DENIED: "内容不存在或当前无权访问，请刷新后检查。",
  BODY_TOO_LARGE: "内容过长，请缩短后重试。",
  INTERNAL_ERROR: "服务内部错误。输入已保留，请查看终端诊断并重试。",
  NETWORK_ERROR: "无法连接本地服务。输入已保留，请确认服务运行后重试。",
};
function el(tag, text, cls) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}
function button(text, handler, cls = "text-button") {
  const b = el("button", text, cls);
  b.type = "button";
  b.addEventListener("click", handler);
  return b;
}
function showError(node, error) {
  const dialog = node.closest("dialog");
  if (node.parentElement.closest("[hidden]") || (dialog && !dialog.open)) {
    notify("界面读取失败，请刷新页面重试。" + error.message, true);
    return;
  }
  node.textContent = error.message;
  node.hidden = false;
  node.tabIndex = -1;
  node.focus();
}
function notify(message, bad = false) {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  $("toast").className = "toast" + (bad ? " is-error" : "");
  $("toast").hidden = false;
  if (!bad) toastTimer = setTimeout(() => ($("toast").hidden = true), 4500);
}
function lock(message) {
  state.csrf = null;
  state.loadVersion++;
  $("workspace").hidden = true;
  $("login").hidden = false;
  if ($("editor").open) $("editor").close();
  if (message) {
    $("pair-error").textContent = message;
    $("pair-error").hidden = false;
  }
}
async function api(path, body) {
  let response;
  try {
    response = await fetch("/v1/console" + path, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      mode: "same-origin",
      redirect: "error",
      headers:
        body === undefined
          ? {}
          : {
              "content-type": "application/json",
              "x-csrf-token": state.csrf ?? "",
            },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    const e = new Error(errors.NETWORK_ERROR);
    e.code = "NETWORK_ERROR";
    throw e;
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("本地服务返回了无法识别的响应，请查看终端诊断。");
  }
  if (!response.ok) {
    const code = payload.code ?? "INTERNAL_ERROR";
    const e = new Error(
      (errors[code] ?? "操作失败，请重试。") +
        (payload.incident_id ? " 错误编号：" + payload.incident_id : ""),
    );
    e.code = code;
    e.status = response.status;
    if (code === "SESSION_REQUIRED" && path !== "/pair" && state.csrf)
      lock(e.message);
    throw e;
  }
  if (payload.kind !== "console_result")
    throw new Error("服务响应契约不匹配，请停止操作并检查版本。");
  return payload.data;
}
async function command(kind, data, key) {
  const signature = JSON.stringify({ kind, ...data });
  let attempt = pending.get(key);
  if (!attempt || attempt.signature !== signature) {
    attempt = { signature, action_id: crypto.randomUUID() };
    pending.set(key, attempt);
  }
  const result = await api("/commands", {
    kind,
    action_id: attempt.action_id,
    ...data,
  });
  pending.delete(key);
  return result;
}
async function busy(form, work, errorNode) {
  if (form.getAttribute("aria-busy") === "true") return;
  form.setAttribute("aria-busy", "true");
  const controls = [...form.querySelectorAll("button,input,select,textarea")],
    previous = controls.map((c) => c.disabled);
  const submit = form.querySelector("[type=submit]");
  const label = submit?.textContent;
  controls.forEach((c) => (c.disabled = true));
  if (submit) submit.textContent = "正在保存…";
  errorNode.hidden = true;
  try {
    await work();
  } catch (e) {
    showError(errorNode, e);
  } finally {
    controls.forEach((c, i) => (c.disabled = previous[i]));
    if (submit) submit.textContent = label;
    form.removeAttribute("aria-busy");
  }
}
function rememberComposer() {
  if (state.selected && state.view?.project.id === state.selected)
    drafts.set(state.selected, {
      text: $("message-body").value,
      recipient: $("recipient").value,
    });
}
function renderProjects() {
  const list = $("project-list");
  list.replaceChildren();
  $("project-count").textContent = state.projects.length;
  for (const project of state.projects) {
    const b = button(
      "",
      () => {
        void selectProject(project.id).catch((e) => notify(e.message, true));
      },
      "project-button" + (project.id === state.selected ? " active" : ""),
    );
    b.setAttribute("aria-label", "打开项目群 " + project.name);
    if (project.id === state.selected) b.setAttribute("aria-current", "page");
    b.append(el("span", project.name.slice(0, 1), "project-symbol"));
    const text = el("span", undefined, "project-copy");
    text.append(
      el("b", project.name),
      el("small", project.description || "本地项目群"),
    );
    b.append(text);
    list.append(b);
  }
  const selected = list.querySelector("[aria-current=page]");
  if (selected && list.scrollWidth > list.clientWidth) {
    const item = selected.getBoundingClientRect(),
      viewport = list.getBoundingClientRect();
    if (item.left < viewport.left) list.scrollLeft -= viewport.left - item.left;
    else if (item.right > viewport.right)
      list.scrollLeft += item.right - viewport.right;
  }
  if (!state.projects.length)
    list.append(el("p", "还没有项目群。创建一个开始吧。", "empty"));
}
async function refreshProjects() {
  state.projects = await api("/projects");
  renderProjects();
}
async function enter() {
  $("pair-code").value = "";
  $("login").hidden = true;
  $("workspace").hidden = false;
  await refreshProjects();
  const last = sessionStorage.getItem("team-selected-project");
  const target =
    state.projects.find((p) => p.id === state.selected || p.id === last) ??
    state.projects[0];
  if (target) await selectProject(target.id);
  else {
    $("workspace").classList.add("no-project");
    $("welcome").hidden = false;
    $("project-view").hidden = true;
    $("members-panel").hidden = true;
  }
}
async function selectProject(id) {
  rememberComposer();
  if (state.selected !== id) {
    state.query = "";
    $("search-input").value = "";
    state.selected = id;
    const saved = drafts.get(id);
    $("message-body").value = saved?.text ?? "";
    sessionStorage.setItem("team-selected-project", id);
  }
  if (state.view?.project.id !== id) {
    state.view = null;
    $("project-view").hidden = true;
    $("members-panel").hidden = true;
    $("welcome").hidden = true;
    $("project-load-state").hidden = false;
    $("project-load-text").textContent = "正在读取项目群…";
    renderProjects();
  }
  try {
    await loadProject(id);
  } catch (error) {
    if (state.selected === id && !state.view)
      $("project-load-text").textContent =
        "项目群读取失败，请重试或选择其他群。";
    throw error;
  }
}
async function loadProject(id = state.selected) {
  if (!id) return;
  const version = ++state.loadVersion;
  const view = await api("/projects/" + id);
  if (version !== state.loadVersion || state.selected !== id) return;
  state.view = view;
  $("project-load-state").hidden = true;
  $("workspace").classList.remove("no-project");
  $("welcome").hidden = true;
  $("project-view").hidden = false;
  $("members-panel").hidden = false;
  $("project-title").textContent = view.project.name;
  $("project-description").textContent =
    view.project.description || "记录目标与协作，让每一步都有据可查。";
  renderProjects();
  renderMembers();
  renderTasks();
  renderProgress();
  renderRecipient();
  if (state.query) {
    await search(state.query);
  } else {
    state.messages = view.messages.items;
    state.before = view.messages.before;
    renderMessages(true);
  }
  setTab(state.tab);
}
async function afterMutation(project, message) {
  notify(message);
  if (project === state.selected) {
    try {
      await loadProject(project);
    } catch (e) {
      notify("已保存，但界面刷新失败。" + e.message, true);
    }
  }
}
function renderProgress() {
  const p = state.view.progress,
    root = $("progress");
  root.replaceChildren();
  for (const [n, label] of [
    [p.registered_members, "登记成员"],
    [p.connected_members, "已连接"],
    [p.draft_tasks, "任务草稿"],
  ]) {
    const metric = el("div", undefined, "metric");
    metric.append(el("b", n), el("span", label));
    root.append(metric);
  }
  root.append(
    el(
      "div",
      "读取于 " +
        new Date(p.observed_at).toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
        }) +
        " · 零模型调用",
      "metric note",
    ),
  );
  $("draft-count").textContent = p.draft_tasks;
}
function renderRecipient() {
  const select = $("recipient");
  const saved = drafts.get(state.selected);
  const old = saved?.recipient ?? "public";
  select.replaceChildren();
  const pub = el("option", "全体成员（公开）");
  pub.value = "public";
  select.append(pub);
  for (const member of state.view.members.filter((m) => m.state === "active")) {
    const o = el("option", "@ " + member.name + "（定向）");
    o.value = member.id;
    select.append(o);
  }
  if (
    old !== "public" &&
    !state.view.members.some((m) => m.id === old && m.state === "active")
  ) {
    const o = el("option", "原接收范围已失效，请重新选择");
    o.value = old;
    o.disabled = true;
    select.append(o);
  }
  select.value = old;
  updateComposer();
}
function updateComposer() {
  const target = $("recipient").value;
  const valid =
    target === "public" ||
    state.view?.members.some((m) => m.id === target && m.state === "active");
  $("audience-hint").textContent = !valid
    ? "范围已失效，不会自动改为公开"
    : target === "public"
      ? "本群公开范围 · 尚未发送给原客户端"
      : "仅你与所选成员的预定接收范围 · 尚未发送";
  $("send-message").disabled = !valid || !$("message-body").value.trim();
  $("char-count").textContent =
    Array.from($("message-body").value).length + " / 8000";
}
function renderMessages(scroll = false) {
  const list = $("message-list");
  list.replaceChildren();
  $("clear-search").hidden = !state.query;
  $("search-status").hidden = !state.query;
  $("older-messages").hidden = !!state.query || !state.before;
  if (!state.messages.length) {
    const empty = el("div", undefined, "empty");
    empty.append(
      el("b", state.query ? "没有找到匹配的消息" : "还没有消息"),
      el(
        "span",
        state.query
          ? "试试其他关键词，或返回全部消息。"
          : "写下第一条项目目标，所有内容只保存在本机。",
      ),
    );
    list.append(empty);
  }
  for (const message of state.messages) {
    const article = el("article", undefined, "message");
    article.append(el("div", "你", "avatar"));
    const main = el("div", undefined, "message-main"),
      meta = el("div", undefined, "message-meta");
    meta.append(
      el("strong", "你"),
      el(
        "span",
        message.audience === "direct"
          ? "定向 · " + message.recipient_name
          : "公开 · 全体成员",
        "audience" + (message.audience === "direct" ? " direct" : ""),
      ),
      el(
        "time",
        new Date(message.created_at).toLocaleString("zh-CN", {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        }),
      ),
    );
    main.append(
      meta,
      el("div", message.body, "message-body"),
      el("div", "已保存本地 · 原客户端尚未接收", "message-foot"),
    );
    article.append(main);
    list.append(article);
  }
  if (scroll) list.scrollTop = list.scrollHeight;
}
async function search(query) {
  const id = state.selected;
  const version = state.loadVersion;
  const result = await api(
    "/projects/" + id + "/search?q=" + encodeURIComponent(query),
  );
  if (
    id !== state.selected ||
    version !== state.loadVersion ||
    state.query !== query
  )
    return;
  state.messages = result.items;
  state.before = null;
  $("search-status").textContent =
    "搜索“" +
    query +
    "” · " +
    result.items.length +
    " 条结果" +
    (result.truncated ? "（最多显示最近 50 条，请缩小关键词）" : "");
  renderMessages();
}
function renderMembers() {
  const list = $("member-list");
  list.replaceChildren();
  $("member-count").textContent = state.view.members.filter(
    (m) => m.state === "active",
  ).length;
  if (!state.view.members.length)
    list.append(
      el("p", "登记成员后，可以明确职责和定向消息的接收范围。", "empty"),
    );
  for (const member of state.view.members) {
    const card = el(
      "article",
      undefined,
      "member" + (member.state === "inactive" ? " inactive" : ""),
    );
    card.dataset.client = member.client;
    const top = el("div", undefined, "member-top");
    top.append(
      el(
        "div",
        member.client === "codex"
          ? "C"
          : member.client === "claude_desktop"
            ? "A"
            : "D",
        "avatar member-avatar",
      ),
    );
    const copy = el("div", undefined, "member-copy");
    copy.append(
      el("b", member.name),
      el(
        "small",
        clients[member.client] +
          " · " +
          (member.state === "inactive" ? "已停用" : "未连接"),
      ),
    );
    top.append(copy);
    const actions = el("div", undefined, "member-actions");
    actions.append(
      button("编辑职责", () => memberDialog(member)),
      button(member.state === "active" ? "停用成员" : "重新启用", async (e) => {
        const b = e.currentTarget;
        b.disabled = true;
        try {
          await command(
            "set_member_state",
            {
              project_id: member.project_id,
              member_id: member.id,
              expected_revision: member.revision,
              state: member.state === "active" ? "inactive" : "active",
            },
            "member-state:" + member.id,
          );
          await afterMutation(
            member.project_id,
            member.state === "active"
              ? "成员已停用，访问授权已撤销。"
              : "成员已启用；原客户端仍未连接，旧授权不会恢复。",
          );
        } catch (error) {
          notify(error.message, true);
        } finally {
          b.disabled = false;
        }
      }),
    );
    card.append(top, el("p", member.role || "尚未填写职责"), actions);
    list.append(card);
  }
}
function renderTasks() {
  const list = $("task-list");
  list.replaceChildren();
  if (!state.view.tasks.length) {
    const empty = el("div", undefined, "empty");
    empty.append(
      el("b", "下一步，从一份清晰的草稿开始"),
      el("span", "写下任务、负责人和验收要求。不会自动派工。"),
    );
    list.append(empty);
  }
  for (const task of state.view.tasks) {
    const card = el(
        "article",
        undefined,
        "task-card" + (task.state === "archived" ? " archived" : ""),
      ),
      title = el("div", undefined, "task-title-row");
    title.append(
      el("h3", task.title),
      el(
        "span",
        task.state === "archived" ? "已归档" : "草稿 · 未派送",
        "task-state",
      ),
    );
    card.append(title);
    if (task.description) card.append(el("p", task.description));
    card.append(
      el(
        "p",
        "验收草案：" + (task.acceptance || "尚未填写，执行前须明确并确认。"),
        "acceptance",
      ),
    );
    const meta = el("div", undefined, "task-meta");
    const member = state.view.members.find((m) => m.id === task.assignee_id);
    meta.append(
      el(
        "span",
        "计划负责人：" +
          (member
            ? member.name + (member.state === "inactive" ? "（已停用）" : "")
            : "待分配"),
      ),
      el("span", "v" + task.revision),
    );
    const actions = el("div", undefined, "task-actions");
    if (task.state === "draft")
      actions.append(button("编辑草稿", () => taskDialog(task)));
    actions.append(
      button(task.state === "draft" ? "归档" : "恢复草稿", async (e) => {
        const b = e.currentTarget;
        b.disabled = true;
        try {
          await command(
            task.state === "draft" ? "archive_draft" : "restore_draft",
            {
              project_id: task.project_id,
              task_id: task.id,
              expected_revision: task.revision,
            },
            "task-state:" + task.id,
          );
          await afterMutation(
            task.project_id,
            task.state === "draft"
              ? "草稿已归档，内容仍保留，可随时恢复。"
              : "已恢复为草稿，尚未派工。",
          );
        } catch (error) {
          notify(error.message, true);
        } finally {
          b.disabled = false;
        }
      }),
    );
    meta.append(actions);
    card.append(meta);
    list.append(card);
  }
}
function setTab(tab) {
  state.tab = tab;
  $("tab-chat").setAttribute("aria-selected", tab === "chat");
  $("tab-tasks").setAttribute("aria-selected", tab === "tasks");
  $("chat-panel").hidden = tab !== "chat";
  $("tasks-panel").hidden = tab !== "tasks";
}
function field(
  label,
  name,
  {
    type = "input",
    value = "",
    max = 4000,
    required = false,
    options = [],
    hint = "",
  } = {},
) {
  const wrapper = el("div", undefined, "field"),
    id = "field-" + name;
  const l = el("label", label);
  l.htmlFor = id;
  const control = document.createElement(type);
  control.id = id;
  control.name = name;
  if (type === "select") {
    for (const [v, t, disabled] of options) {
      const option = el("option", t);
      option.value = v;
      option.disabled = !!disabled;
      control.append(option);
    }
  } else {
    control.maxLength = max;
    if (type === "textarea") control.rows = 3;
  }
  control.value = value;
  control.required = required;
  wrapper.append(l, control);
  if (hint) wrapper.append(el("small", hint));
  $("editor-fields").append(wrapper);
  return control;
}
function editor(title, description, build, onSubmit) {
  $("editor-title").textContent = title;
  $("editor-description").textContent = description;
  $("editor-fields").replaceChildren();
  $("editor-error").hidden = true;
  build();
  editorSubmit = onSubmit;
  $("editor").showModal();
}
function projectDialog() {
  editor(
    "新建项目群",
    "先建立一个清晰的项目空间。不会启动客户端或产生模型费用。",
    () => {
      field("项目群名称", "name", { max: 80, required: true });
      field("项目目标 / 说明", "description", {
        type: "textarea",
        hint: "可稍后通过群消息补充讨论。",
      });
    },
    async (data) => {
      const project = await command("create_project", data, "create-project");
      $("editor").close();
      try {
        await refreshProjects();
        state.query = "";
        await selectProject(project.id);
        notify("项目群已创建。下一步可以登记成员。");
      } catch (error) {
        notify(
          "项目群已创建，但界面刷新失败。请刷新页面查看，勿重复创建。" +
            error.message,
          true,
        );
      }
    },
  );
}
function memberDialog(member) {
  const project = state.selected;
  editor(
    member ? "编辑成员职责" : "登记项目成员",
    "仅登记原客户端身份和职责，不会启动、替换或自动连接客户端。",
    () => {
      if (!member) {
        const client = field("原客户端", "client", {
          type: "select",
          value: "codex",
          options: Object.entries(clients),
        });
        const name = field("显示名称", "name", {
          value: "Codex",
          max: 60,
          required: true,
        });
        client.addEventListener("change", () => {
          if (!name.value || Object.values(clients).includes(name.value))
            name.value = clients[client.value];
        });
      } else
        field("显示名称", "name", {
          value: member.name,
          max: 60,
          required: true,
        });
      field("职责", "role", {
        type: "textarea",
        value: member?.role ?? "",
        max: 120,
        hint: "分工由你决定，不预设不同厂商的能力。",
      });
    },
    async (data) => {
      await command(
        member ? "update_member" : "add_member",
        {
          project_id: project,
          ...data,
          ...(member
            ? { member_id: member.id, expected_revision: member.revision }
            : {}),
        },
        member ? "edit-member:" + member.id : "add-member:" + project,
      );
      $("editor").close();
      await afterMutation(
        project,
        member ? "成员资料已更新。" : "成员已登记，原客户端仍未连接。",
      );
    },
  );
}
function taskDialog(task) {
  const project = state.selected;
  editor(
    task ? "编辑任务草稿" : "新建任务草稿",
    "保存不会领取任务、授予写权限或触发 Agent。验收内容仍是待确认草案。",
    () => {
      field("任务标题", "title", {
        value: task?.title ?? "",
        max: 160,
        required: true,
      });
      field("计划负责人", "assignee_id", {
        type: "select",
        value: task?.assignee_id ?? "",
        options: [
          ["", "待分配"],
          ...state.view.members.map((m) => [
            m.id,
            m.name + (m.state === "inactive" ? "（已停用，请重选）" : ""),
            m.state !== "active",
          ]),
        ],
      });
      field("任务描述", "description", {
        type: "textarea",
        value: task?.description ?? "",
      });
      field("验收草案", "acceptance", {
        type: "textarea",
        value: task?.acceptance ?? "",
        max: 2000,
        hint: "不填写则保留“待明确”；不会显示为已确认验收。",
      });
    },
    async (data) => {
      if (!Object.hasOwn(data, "assignee_id"))
        throw new Error(
          "计划负责人已停用，请明确选择有效成员或“待分配”。不会自动清空原负责人。",
        );
      await command(
        task ? "update_draft" : "create_draft",
        {
          project_id: project,
          ...data,
          assignee_id: data.assignee_id || null,
          ...(task
            ? { task_id: task.id, expected_revision: task.revision }
            : {}),
        },
        task ? "edit-task:" + task.id : "create-task:" + project,
      );
      $("editor").close();
      setTab("tasks");
      await afterMutation(project, "任务草稿已保存，尚未派工。");
    },
  );
}
$("pair-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const code = $("pair-code").value.trim();
  void busy(
    $("pair-form"),
    async () => {
      const session = await api("/pair", { code });
      state.csrf = session.csrf;
      await enter();
    },
    $("pair-error"),
  );
});
$("editor-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData($("editor-form")));
  editorBusy = true;
  void busy(
    $("editor-form"),
    () => editorSubmit(data),
    $("editor-error"),
  ).finally(() => (editorBusy = false));
});
for (const id of ["editor-close", "editor-cancel"])
  $(id).addEventListener("click", () => {
    if (!editorBusy) $("editor").close();
  });
$("editor").addEventListener("cancel", (e) => {
  if (editorBusy) e.preventDefault();
});
for (const id of ["new-project", "welcome-create"])
  $(id).addEventListener("click", projectDialog);
$("add-member").addEventListener("click", () => memberDialog());
$("new-task").addEventListener("click", () => taskDialog());
$("tab-chat").addEventListener("click", () => setTab("chat"));
$("tab-tasks").addEventListener("click", () => setTab("tasks"));
$("retry-project").addEventListener("click", () => {
  void selectProject(state.selected).catch((e) => notify(e.message, true));
});
$("refresh").addEventListener("click", async () => {
  const b = $("refresh");
  b.disabled = true;
  try {
    await loadProject();
    notify("已读取最新本地状态，没有打断任务或调用模型。");
  } catch (e) {
    notify(e.message, true);
  } finally {
    b.disabled = false;
  }
});
$("recipient").addEventListener("change", () => {
  rememberComposer();
  updateComposer();
});
$("message-body").addEventListener("input", () => {
  rememberComposer();
  updateComposer();
});
$("message-body").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.isComposing) {
    e.preventDefault();
    if (!$("send-message").disabled) $("compose-form").requestSubmit();
  }
});
$("compose-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const project = state.selected,
    body = $("message-body").value,
    recipient = $("recipient").value;
  void busy(
    $("compose-form"),
    async () => {
      await command(
        "send_message",
        {
          project_id: project,
          body,
          audience: recipient === "public" ? "public" : "direct",
          recipient_id: recipient === "public" ? null : recipient,
        },
        "message:" + project,
      );
      drafts.set(project, { text: "", recipient });
      if (project === state.selected && $("message-body").value === body)
        $("message-body").value = "";
      await afterMutation(project, "消息已保存本地，原客户端尚未接收。");
    },
    $("compose-error"),
  ).finally(updateComposer);
});
$("search-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = $("search-input").value.trim();
  if (!query) {
    state.query = "";
    await loadProject().catch((error) => notify(error.message, true));
    return;
  }
  state.query = query;
  try {
    await search(query);
  } catch (error) {
    notify(error.message, true);
  }
});
$("clear-search").addEventListener("click", () => {
  state.query = "";
  $("search-input").value = "";
  void loadProject().catch((e) => notify(e.message, true));
});
$("older-messages").addEventListener("click", async () => {
  const project = state.selected,
    before = state.before,
    b = $("older-messages");
  b.disabled = true;
  try {
    const result = await api(
      "/projects/" + project + "/messages?before=" + encodeURIComponent(before),
    );
    if (project !== state.selected || state.query) return;
    state.messages = [...result.items, ...state.messages];
    state.before = result.before;
    renderMessages();
  } catch (error) {
    notify(error.message, true);
  } finally {
    b.disabled = false;
  }
});
$("logout").addEventListener("click", async () => {
  rememberComposer();
  if (
    [...drafts.values()].some((d) => d.text.trim()) &&
    !window.confirm("还有未保存的消息。退出会丢弃这些输入，是否继续？")
  )
    return;
  try {
    await api("/logout", {});
    drafts.clear();
    pending.clear();
    sessionStorage.removeItem("team-selected-project");
    state.selected = null;
    state.view = null;
    state.projects = [];
    state.query = "";
    $("message-body").value = "";
    $("search-input").value = "";
    lock("已安全退出。配对码只可使用一次，请运行 npm run pair 获取新码。");
  } catch (e) {
    notify(e.message, true);
  }
});
window.addEventListener("beforeunload", (event) => {
  rememberComposer();
  if (
    [...drafts.values()].some((d) => d.text.trim()) ||
    ($("editor").open &&
      [...$("editor-fields").querySelectorAll("input,textarea")].some((i) =>
        i.value.trim(),
      ))
  ) {
    event.preventDefault();
    event.returnValue = "";
  }
});
window.addEventListener("unhandledrejection", (event) => {
  notify(
    "界面遇到未处理错误，请查看浏览器控制台。" + (event.reason?.message ?? ""),
    true,
  );
});
(async () => {
  try {
    const session = await api("/session");
    state.csrf = session.csrf;
    await enter();
  } catch (e) {
    if (e.code !== "SESSION_REQUIRED") showError($("pair-error"), e);
  }
})();
