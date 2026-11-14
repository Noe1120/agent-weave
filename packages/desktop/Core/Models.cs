namespace Team.Core;

public sealed record Project(string Id, string Name, string Description, string PublicChannelId, string Revision, string CreatedAt);
public sealed record Member(string Id, string ProjectId, string Client, string Name, string Role, string State, string Revision, string CreatedAt, string Connection)
{
    public string ClientName => Client switch { "codex" => "Codex", "claude_desktop" => "Claude Desktop", "deepseek_harness" => "DeepSeek Harness", _ => Client };
    public string Status => State == "active" ? "未连接" : "已停用";
    public string Label => Name + (State == "inactive" ? "（已停用）" : "");
}
public sealed record Message(string Id, string ProjectId, string ChannelId, string Body, string Audience, string? RecipientId, string CreatedAt, string? RecipientName, string DeliveryState)
{
    public string Heading => Audience == "direct" ? "仅自己与 " + RecipientName : "自己 · 群聊";
    public string Time => DateTimeOffset.TryParse(CreatedAt, out var t) ? t.ToLocalTime().ToString("MM/dd HH:mm") : "";
}
public sealed record Draft(string Id, string ProjectId, string Title, string Description, string Acceptance, string? AssigneeId, string State, string Revision, string CreatedAt, string UpdatedAt)
{
    public string Status => State == "archived" ? "已归档" : "草稿";
}
public sealed record MessagePage(Message[] Items, [property: System.Text.Json.Serialization.JsonPropertyName("before")] string? NextBefore);
public sealed record SearchPage(Message[] Items, bool Truncated);
public sealed record Progress(int RegisteredMembers, int ConnectedMembers, int DraftTasks, int ArchivedTasks, bool ExecutionEnabled, int ModelCalls, string ObservedAt);
public sealed record ProjectSnapshot(Project Project, Member[] Members, Draft[] Tasks, MessagePage Messages, Progress Progress);
public sealed record Choice(string? Id, string Label) { public override string ToString() => Label; }
public sealed class MessageInput { public string Body { get; set; } = ""; public string? RecipientId { get; set; } public CommandAttempt? Pending { get; set; } }

