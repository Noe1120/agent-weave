using System.Security.Cryptography;
using System.Text;
namespace Team.Core;

public static class DataLocation
{
    public static string Resolve(string[] args)
    {
        if (args.Length == 0) return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Team", "core.sqlite");
        if (args.Length != 2 || args[0] != "--data" || !Path.IsPathFullyQualified(args[1])) throw new ArgumentException("用法：Team.exe [--data <数据库绝对路径>]");
        var full = Path.GetFullPath(args[1]);
        if (full.StartsWith(@"\\") || new DriveInfo(Path.GetPathRoot(full)!).DriveType == DriveType.Network) throw new ArgumentException("数据库必须放在本机磁盘，不能使用网络共享盘。");
        return full;
    }
    public static string InstanceKey(string path) => "Team-" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Path.GetFullPath(path).ToUpperInvariant())));
}
public sealed class WorkspaceController(IWorkspaceApi api)
{
    int generation;
    IWorkspaceApi currentApi = api;
    public void Reconnect(IWorkspaceApi next) { generation++; currentApi = next; Current = null; SelectedId = null; }
    readonly Dictionary<string, MessageInput> inputs = [];
    public ProjectSnapshot? Current { get; private set; }
    public string? SelectedId { get; private set; }
    public bool HasUnsavedInput => inputs.Values.Any(x => !string.IsNullOrWhiteSpace(x.Body) || x.Pending is not null);
    public MessageInput Input(string projectId) { if (!inputs.TryGetValue(projectId, out var value)) inputs[projectId] = value = new(); return value; }
    public async Task SelectProjectAsync(string id)
    {
        var request = ++generation; Current = null; SelectedId = null;
        var snapshot = await currentApi.GetAsync<ProjectSnapshot>("projects/" + id);
        if (request != generation) return;
        if (snapshot.Project.Id != id) throw new InvalidDataException("Project identity mismatch");
        Current = snapshot; SelectedId = id;
    }
}


