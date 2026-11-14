using System.Net;
using System.Text;
using System.Text.Json;

namespace Team.Core;

public interface IWorkspaceApi
{
    Task<T> GetAsync<T>(string path);
    Task<T> CommandAsync<T>(JsonElement payload);
}
public sealed class ApiException(string code, int statusCode = 400) : Exception(code)
{
    public string Code { get; } = code;
    public int StatusCode { get; } = statusCode;
    public bool RequiresReconnect => Code is "SESSION_REQUIRED" or "CSRF_REJECTED";
    public string UserMessage => Code switch
    {
        "REVISION_CONFLICT" => "内容已被修改。你的输入已保留，请读取最新版本后再保存。",
        "MEMBER_INACTIVE" => "成员已停用。请明确更换收件人或负责人；不会自动改为群聊。",
        "MEMBER_NAME_EXISTS" => "此项目已有同名成员。",
        "INVALID_REQUEST" => "输入不符合要求，请检查内容和长度。",
        "SESSION_REQUIRED" => "会话已过期，请重新连接。输入仍保留。",
        "CSRF_REJECTED" => "会话校验失败，请重新连接。",
        "NOT_FOUND_OR_DENIED" => "内容不存在或无权读取。",
        _ => "操作未完成（" + Code + "）。"
    };
}
public sealed class ApiClient : IWorkspaceApi, IDisposable
{
    public static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower, PropertyNameCaseInsensitive = false };
    readonly HttpClient http;
    string? csrf;
    public ApiClient(int port)
    {
        var origin = "http://127.0.0.1:" + port;
        http = new(new HttpClientHandler { UseProxy = false, AllowAutoRedirect = false, UseCookies = true, CookieContainer = new CookieContainer() }) { BaseAddress = new Uri(origin + "/v1/console/"), Timeout = TimeSpan.FromSeconds(12) };
        http.DefaultRequestHeaders.Add("Origin", origin);
    }
    public async Task PairAsync(string code)
    {
        var result = await SendAsync<JsonElement>(HttpMethod.Post, "pair", JsonSerializer.SerializeToElement(new { code }));
        csrf = result.GetProperty("csrf").GetString() ?? throw new InvalidDataException("Missing CSRF");
    }
    public Task<T> GetAsync<T>(string path) => SendAsync<T>(HttpMethod.Get, path, null);
    public Task<T> CommandAsync<T>(JsonElement payload) => SendAsync<T>(HttpMethod.Post, "commands", payload);
    public Task LogoutAsync() => SendAsync<JsonElement>(HttpMethod.Post, "logout", JsonSerializer.SerializeToElement(new { }));
    async Task<T> SendAsync<T>(HttpMethod method, string path, JsonElement? payload)
    {
        if (path.StartsWith('/') || path.Contains("://") || path.Split('?')[0].Contains("..")) throw new ArgumentException("Relative console path required");
        using var request = new HttpRequestMessage(method, path);
        if (csrf is not null) request.Headers.Add("X-CSRF-Token", csrf);
        if (payload is not null) request.Content = new StringContent(payload.Value.GetRawText(), Encoding.UTF8, "application/json");
        using var response = await http.SendAsync(request);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = body.RootElement;
        if (!response.IsSuccessStatusCode) throw new ApiException(root.TryGetProperty("code", out var c) ? c.GetString() ?? "HTTP_ERROR" : "HTTP_ERROR", (int)response.StatusCode);
        if (root.GetProperty("contract_version").GetString() != "workspace/0.1" || root.GetProperty("kind").GetString() != "console_result") throw new InvalidDataException("Unsupported console response");
        return root.GetProperty("data").Deserialize<T>(Json) ?? throw new InvalidDataException("Empty console response");
    }
    public void Dispose() { csrf = null; http.Dispose(); }
}

// A retry is the same command, never a new action with a changed recipient/body.
public sealed class CommandAttempt
{
    public JsonElement Payload { get; }
    JsonElement? result;
    public bool IsCommitted => result.HasValue;
    public bool HasUncertainResult { get; private set; }
    public CommandAttempt(object payload)
    {
        var fields = JsonSerializer.SerializeToElement(payload, ApiClient.Json).EnumerateObject().ToDictionary(x => x.Name, x => x.Value.Clone());
        fields["action_id"] = JsonSerializer.SerializeToElement(Guid.NewGuid().ToString());
        Payload = JsonSerializer.SerializeToElement(fields);
    }
    public async Task<T> ExecuteAsync<T>(IWorkspaceApi api)
    {
        try { result ??= await api.CommandAsync<JsonElement>(Payload); HasUncertainResult = false; }
        catch (ApiException e) { if (e.StatusCode >= 500) HasUncertainResult = true; throw; }
        catch { HasUncertainResult = true; throw; }
        return result.Value.Deserialize<T>(ApiClient.Json) ?? throw new InvalidDataException("Empty command response");
    }
}




