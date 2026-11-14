using System.Text.Json;
using System.Diagnostics;
using Team.Core;

if (args.Length == 5 && args[0] == "--host-probe")
{
    await using var probe = await ServiceHost.StartAsync(args[1], args[2], args[3]);
    await File.WriteAllTextAsync(args[4], JsonSerializer.Serialize(new { pid = probe.ProcessId, port = probe.Port }));
    await Task.Delay(Timeout.Infinite); return 0;
}
var root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../"));
var tests = new List<(string, Func<Task>)>();
void Test(string name, Func<Task> test) => tests.Add((name, test));
void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
async Task Throws<T>(Func<Task> action) where T : Exception { try { await action(); } catch (T) { return; } throw new Exception("Expected " + typeof(T).Name); }
ProjectSnapshot Snapshot(string id) => new(new(id, "Project " + id, "", "channel", "1", ""), [], [], new([], null), new(0, 0, 0, 0, false, 0, ""));

Test("uncertain retry uses identical action id and immutable payload", async () =>
{
    var api = new FakeApi(); var payload = new Dictionary<string, object?> { ["kind"] = "send_message", ["body"] = "private" };
    var attempt = new CommandAttempt(payload); payload["body"] = "changed";
    api.Command = (_, _) => throw new HttpRequestException("response lost");
    await Throws<HttpRequestException>(() => attempt.ExecuteAsync<JsonElement>(api));
    var first = api.LastPayload;
    api.Command = (_, _) => Task.FromResult(JsonSerializer.SerializeToElement(new { id = "saved" }));
    await attempt.ExecuteAsync<JsonElement>(api);
    Check(first == api.LastPayload, "Retry changed its payload");
    Check(api.LastPayload.Contains("private") && !api.LastPayload.Contains("changed"), "Caller changed frozen payload");
    await attempt.ExecuteAsync<JsonElement>(api);
    Check(api.Commands == 2, "Resolved attempt was sent twice");
});
Test("a lost response remains uncertain across an expired session", async () =>
{
    var api = new FakeApi(); var attempt = new CommandAttempt(new { kind = "send_message", body = "one" });
    api.Command = (_, _) => throw new HttpRequestException("lost");
    await Throws<HttpRequestException>(() => attempt.ExecuteAsync<JsonElement>(api));
    Check(attempt.HasUncertainResult, "Lost response not marked uncertain");
    api.Command = (_, _) => throw new ApiException("SESSION_REQUIRED");
    await Throws<ApiException>(() => attempt.ExecuteAsync<JsonElement>(api));
    Check(attempt.HasUncertainResult, "Expired session cleared unknown commit status");
});
Test("failed project switch clears stale writable project but keeps its input", async () =>
{
    var api = new FakeApi(); api.Query = (_, _) => Task.FromResult<object>(Snapshot("a"));
    var controller = new WorkspaceController(api); await controller.SelectProjectAsync("a");
    controller.Input("a").Body = "unsaved"; controller.Input("a").RecipientId = "private-member";
    api.Query = (_, _) => throw new HttpRequestException("offline");
    await Throws<HttpRequestException>(() => controller.SelectProjectAsync("b"));
    Check(controller.Current is null && controller.SelectedId is null, "Stale writable selection survived");
    Check(controller.Input("a").Body == "unsaved" && controller.Input("a").RecipientId == "private-member", "Input lost or public fallback");
});
Test("out of order project reads cannot change the latest selection", async () =>
{
    var api = new FakeApi(); var first = new TaskCompletionSource<object>();
    api.Query = (path, _) => path.EndsWith("a") ? first.Task : Task.FromResult<object>(Snapshot("b"));
    var controller = new WorkspaceController(api); var old = controller.SelectProjectAsync("a");
    await controller.SelectProjectAsync("b"); first.SetResult(Snapshot("a")); await old;
    Check(controller.Current?.Project.Id == "b", "Old request won");
});
Test("response project identity is checked", async () =>
{
    var api = new FakeApi { Query = (_, _) => Task.FromResult<object>(Snapshot("other")) };
    var controller = new WorkspaceController(api);
    await Throws<InvalidDataException>(() => controller.SelectProjectAsync("requested"));
    Check(controller.Current is null, "Unexpected project adopted");
});
Test("data path is explicit absolute and stable, instance key ignores case", async () =>
{
    Check(DataLocation.Resolve([]).EndsWith(Path.Combine("Team", "core.sqlite")), "Default DB is not per-user");
    await Throws<ArgumentException>(() => Task.FromResult(DataLocation.Resolve(["--data", "relative.sqlite"])));
    var p = Path.Combine(Path.GetTempPath(), "Team-Path", "Core.sqlite");
    Check(DataLocation.Resolve(["--data", p]) == p, "Explicit DB not honored");
    Check(DataLocation.InstanceKey(p) == DataLocation.InstanceKey(p.ToUpperInvariant()), "Case variants bypass lock");
    await Throws<ArgumentException>(() => Task.FromResult(DataLocation.Resolve(["--data", @"\\server\share\core.sqlite"])));
});

Test("native host authenticates, preserves workspace semantics and stops its child", async () =>
{
    var dir = Path.Combine(Path.GetTempPath(), "team-native-" + Guid.NewGuid()); Directory.CreateDirectory(dir);
    var db = Path.Combine(dir, "core.sqlite"); var node = Environment.GetEnvironmentVariable("TEAM_TEST_NODE") ?? @"D:\新建文件夹\node.exe";
    var entry = (Environment.GetEnvironmentVariable("TEAM_TEST_ENTRY") ?? Path.Combine(root, "dist/packages/service/src/desktop-entry.js"));
    string projectId; int port;
    try
    {
        await using (var host = await ServiceHost.StartAsync(node, entry, db))
        {
            port = host.Port; var api = host.Api;
            Check(host.ProcessId > 0 && host.IsRunning, "No owned process");
            await Throws<IOException>(async () => { await using var duplicate = await ServiceHost.StartAsync(node, entry, db); });
            var projects = await api.GetAsync<Project[]>("projects"); Check(projects.Length == 0, "DB not isolated");
            async Task<T> Cmd<T>(object p) => await new CommandAttempt(p).ExecuteAsync<T>(api);
            var p = await Cmd<Project>(new { kind = "create_project", name = "原生验收", description = "" }); projectId = p.Id;
            var m = await Cmd<Member>(new { kind = "add_member", project_id = p.Id, client = "codex", name = "Codex", role = "开发" });
            Check(m.Connection == "not_connected", "False connectivity");
            var d = await Cmd<Draft>(new { kind = "create_draft", project_id = p.Id, title = "草稿", description = "内容", acceptance = "检查", assignee_id = m.Id });
            var a = new CommandAttempt(new { kind = "send_message", project_id = p.Id, audience = "direct", recipient_id = m.Id, body = "literal %_! 中文 .." });
            var msg = await a.ExecuteAsync<Message>(api); await a.ExecuteAsync<Message>(api);
            Check(msg.Audience == "direct" && msg.DeliveryState == "stored_not_dispatched", "Scope/status changed");
            var found = await api.GetAsync<SearchPage>("projects/" + p.Id + "/search?q=" + Uri.EscapeDataString("%_!"));
            Check(found.Items.Length == 1, "Literal search mismatch or duplicate message");
            Check((await api.GetAsync<SearchPage>("projects/" + p.Id + "/search?q=..")).Items.Length == 1, "Literal dots were rejected");
            await Cmd<Member>(new { kind = "update_member", project_id = p.Id, member_id = m.Id, expected_revision = m.Revision, name = "Codex 开发", role = "前端" });
            await Throws<ApiException>(() => Cmd<Member>(new { kind = "update_member", project_id = p.Id, member_id = m.Id, expected_revision = m.Revision, name = "冲突", role = "" }));
            var state = await api.GetAsync<ProjectSnapshot>("projects/" + p.Id); m = state.Members.Single();
            var inactive = await Cmd<Member>(new { kind = "set_member_state", project_id = p.Id, member_id = m.Id, expected_revision = m.Revision, state = "inactive" });
            await Throws<ApiException>(() => Cmd<Message>(new { kind = "send_message", project_id = p.Id, audience = "direct", recipient_id = m.Id, body = "不得转公开" }));
            await Throws<ApiException>(() => Cmd<Draft>(new { kind = "update_draft", project_id = p.Id, task_id = d.Id, expected_revision = d.Revision, title = d.Title, description = d.Description, acceptance = d.Acceptance, assignee_id = m.Id }));
            await Cmd<Member>(new { kind = "set_member_state", project_id = p.Id, member_id = m.Id, expected_revision = inactive.Revision, state = "active" });
            d = await Cmd<Draft>(new { kind = "update_draft", project_id = p.Id, task_id = d.Id, expected_revision = d.Revision, title = "更新草稿", description = d.Description, acceptance = d.Acceptance, assignee_id = m.Id });
            d = await Cmd<Draft>(new { kind = "archive_draft", project_id = p.Id, task_id = d.Id, expected_revision = d.Revision });
            Check(d.State == "archived", "Archive failed");
            d = await Cmd<Draft>(new { kind = "restore_draft", project_id = p.Id, task_id = d.Id, expected_revision = d.Revision });
            Check(d.State == "draft", "Restore failed");
            var other = await Cmd<Project>(new { kind = "create_project", name = "其他项目", description = "" });
            Check((await api.GetAsync<SearchPage>("projects/" + other.Id + "/search?q=literal")).Items.Length == 0, "Cross project leak");
            for (var i = 0; i < 52; i++) await Cmd<Message>(new { kind = "send_message", project_id = p.Id, audience = "public", recipient_id = (string?)null, body = "消息" + i });
            var page = await api.GetAsync<MessagePage>("projects/" + p.Id + "/messages");
            Check(page.Items.Length == 50 && page.NextBefore is not null, "No stable pagination");
            var older = await api.GetAsync<MessagePage>("projects/" + p.Id + "/messages?before=" + page.NextBefore);
            Check(older.Items.Length == 3 && !older.Items.Select(x => x.Id).Intersect(page.Items.Select(x => x.Id)).Any(), "Pagination overlaps");
            state = await api.GetAsync<ProjectSnapshot>("projects/" + p.Id);
            Check(state.Progress.ConnectedMembers == 0 && !state.Progress.ExecutionEnabled && state.Progress.ModelCalls == 0, "False execution");
        }
        using (var socket = new System.Net.Sockets.TcpClient()) await Throws<System.Net.Sockets.SocketException>(() => socket.ConnectAsync("127.0.0.1", port).WaitAsync(TimeSpan.FromSeconds(5)));
        await using (var reopened = await ServiceHost.StartAsync(node, entry, db))
        {
            var saved = await reopened.Api.GetAsync<ProjectSnapshot>("projects/" + projectId);
            Check(saved.Tasks.Single().Title == "更新草稿" && saved.Messages.Items.Length == 50, "Reopen lost data");
        }
    }
    finally { Directory.Delete(dir, true); }
});
Test("abrupt native host death reclaims only its owned child and database lease", async () =>
{
    var dir = Path.Combine(Path.GetTempPath(), "team-native-crash-" + Guid.NewGuid()); Directory.CreateDirectory(dir);
    var db = Path.Combine(dir, "core.sqlite"); var report = Path.Combine(dir, "child.json");
    var node = Environment.GetEnvironmentVariable("TEAM_TEST_NODE") ?? @"D:\新建文件夹\node.exe";
    var entry = (Environment.GetEnvironmentVariable("TEAM_TEST_ENTRY") ?? Path.Combine(root, "dist/packages/service/src/desktop-entry.js"));
    var start = new ProcessStartInfo(Path.Combine(root, ".tools/dotnet/dotnet.exe")) { UseShellExecute = false, CreateNoWindow = true };
    foreach (var arg in new[] { typeof(FakeApi).Assembly.Location, "--host-probe", node, entry, db, report }) start.ArgumentList.Add(arg);
    using var unrelated = Process.Start(new ProcessStartInfo(node) { UseShellExecute = false, CreateNoWindow = true, ArgumentList = { "-e", "setInterval(()=>{},1000)" } })!;
    using var parent = Process.Start(start)!;
    try
    {
        for (var i = 0; i < 150 && !File.Exists(report) && !parent.HasExited; i++) await Task.Delay(50);
        Check(File.Exists(report), "Host probe did not start");
        using var json = JsonDocument.Parse(await File.ReadAllTextAsync(report)); var pid = json.RootElement.GetProperty("pid").GetInt32();
        using var child = Process.GetProcessById(pid);
        parent.Kill(); await parent.WaitForExitAsync();
        await child.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5));
        Check(!unrelated.HasExited, "Unrelated node was killed");
        await using var reopened = await ServiceHost.StartAsync(node, entry, db);
        Check(reopened.IsRunning, "Orphan lock prevented reopening");
    }
    finally { if (!parent.HasExited) { parent.Kill(); await parent.WaitForExitAsync(); } if (!unrelated.HasExited) { unrelated.Kill(); await unrelated.WaitForExitAsync(); } Directory.Delete(dir, true); }
});
Test("invalid database startup reports failure without replacing the existing file", async () =>
{
    var dir = Path.Combine(Path.GetTempPath(), "team-native-invalid-" + Guid.NewGuid()); Directory.CreateDirectory(dir); var db = Path.Combine(dir, "core.sqlite");
    const string content = "This existing file is not a SQLite database; do not replace."; await File.WriteAllTextAsync(db, content);
    try { await Throws<IOException>(async () => { await using var host = await ServiceHost.StartAsync(Environment.GetEnvironmentVariable("TEAM_TEST_NODE") ?? @"D:\新建文件夹\node.exe", (Environment.GetEnvironmentVariable("TEAM_TEST_ENTRY") ?? Path.Combine(root, "dist/packages/service/src/desktop-entry.js")), db); }); Check(await File.ReadAllTextAsync(db) == content, "Existing file replaced"); Check(!File.Exists(db + ".desktop.lock"), "Failed startup leaked lease"); }
    finally { Directory.Delete(dir, true); }
});
Test("reconnecting preserves every draft recipient and uncertain action", async () =>
{
    var api = new FakeApi { Query = (_, _) => Task.FromResult<object>(Snapshot("a")) }; var controller = new WorkspaceController(api); await controller.SelectProjectAsync("a");
    var input = controller.Input("a"); input.Body = "private"; input.RecipientId = "deactivated"; input.Pending = new(new { kind = "send_message", audience = "direct", recipient_id = "deactivated", body = "private" }); var payload = input.Pending.Payload.GetRawText();
    controller.Reconnect(new FakeApi { Query = (_, _) => Task.FromResult<object>(Snapshot("a")) }); await controller.SelectProjectAsync("a");
    Check(controller.Input("a").RecipientId == "deactivated" && controller.Input("a").Pending?.Payload.GetRawText() == payload, "Reconnect lost private draft or retry identity");
});
Test("console session expiry exposes the real reconnectable contract code", async () =>
{
    var exception = new ApiException("SESSION_REQUIRED"); Check(exception.RequiresReconnect, "Actual console code not reconnectable");
    Check(exception.UserMessage.Contains("会话"), "User sees opaque error instead of session recovery"); await Task.CompletedTask;
});
Test("startup failures retain bounded stderr diagnostics without exposing handshake output", async () =>
{
    var dir = Path.Combine(Path.GetTempPath(), "team-native-diagnostic-" + Guid.NewGuid()); Directory.CreateDirectory(dir); var entry = Path.Combine(dir, "fail.mjs");
    await File.WriteAllTextAsync(entry, "console.error('synthetic startup diagnostic');process.exitCode=1;");
    try { try { await using var host = await ServiceHost.StartAsync(Environment.GetEnvironmentVariable("TEAM_TEST_NODE") ?? @"D:\新建文件夹\node.exe", entry, Path.Combine(dir, "core.sqlite")); throw new Exception("Expected startup failure"); } catch (IOException e) { Check(e.Message.Contains("synthetic startup diagnostic"), "Actual startup diagnostic was hidden"); } }
    finally { Directory.Delete(dir, true); }
});
Test("desktop child receives only its required environment, not ambient secrets", async () =>
{
    var dir = Path.Combine(Path.GetTempPath(), "team-native-env-" + Guid.NewGuid()); Directory.CreateDirectory(dir); var entry = Path.Combine(dir, "entry.mjs");
    var service = new Uri((Environment.GetEnvironmentVariable("TEAM_TEST_ENTRY") ?? Path.Combine(root, "dist/packages/service/src/desktop-entry.js"))).AbsoluteUri;
    await File.WriteAllTextAsync(entry, "if(process.env.TEAM_SYNTHETIC_SECRET){console.error('environment leaked');process.exit(1)}await import(" + JsonSerializer.Serialize(service) + ");");
    var previous = Environment.GetEnvironmentVariable("TEAM_SYNTHETIC_SECRET"); Environment.SetEnvironmentVariable("TEAM_SYNTHETIC_SECRET", "synthetic-only");
    try { await using var host = await ServiceHost.StartAsync(Environment.GetEnvironmentVariable("TEAM_TEST_NODE") ?? @"D:\新建文件夹\node.exe", entry, Path.Combine(dir, "core.sqlite")); Check(host.IsRunning, "Owned service did not start"); }
    finally { Environment.SetEnvironmentVariable("TEAM_SYNTHETIC_SECRET", previous); Directory.Delete(dir, true); }
});
Test("server errors do not turn an unknown commit into a new action", async () =>
{
    var api = new FakeApi { Command = (_, _) => throw new ApiException("INTERNAL_ERROR", 500) };
    var attempt = new CommandAttempt(new { kind = "send_message", body = "once" });
    await Throws<ApiException>(() => attempt.ExecuteAsync<JsonElement>(api));
    Check(attempt.HasUncertainResult, "5xx cleared retry identity despite uncertain commit");
});
int failures = 0;
foreach (var (name, action) in tests) { try { await action(); Console.WriteLine("PASS " + name); } catch (Exception e) { failures++; Console.WriteLine("FAIL " + name + "\n" + e); } }
Console.WriteLine($"Native tests: {tests.Count - failures}/{tests.Count} passed; model calls: 0");
return failures == 0 ? 0 : 1;

sealed class FakeApi : IWorkspaceApi
{
    public Func<string, Type, Task<object>> Query { get; set; } = (_, _) => throw new NotImplementedException();
    public Func<JsonElement, Type, Task<JsonElement>> Command { get; set; } = (_, _) => throw new NotImplementedException();
    public int Commands; public string LastPayload = "";
    public async Task<T> GetAsync<T>(string path) => (T)await Query(path, typeof(T));
    public async Task<T> CommandAsync<T>(JsonElement payload) { Commands++; LastPayload = payload.GetRawText(); return (await Command(payload, typeof(T))).Deserialize<T>(ApiClient.Json)!; }
}









