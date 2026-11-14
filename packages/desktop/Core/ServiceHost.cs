using System.Diagnostics;
using System.Text.Json;
namespace Team.Core;

public sealed class ServiceHost : IAsyncDisposable
{
    readonly Process process;
    readonly ProcessJob job;
    readonly FileStream lease;
    readonly Task stderr;
    bool disposed;
    public ApiClient Api { get; private set; } = null!;
    public int Port { get; private set; }
    public int ProcessId => process.Id;
    public bool IsRunning => !disposed && !process.HasExited;
    public event Action? UnexpectedExit;
    readonly Queue<string> diagnostics = [];
    public string Diagnostic { get { lock (diagnostics) return string.Join(Environment.NewLine, diagnostics); } }
    ServiceHost(Process process, ProcessJob job, FileStream lease)
    {
        this.process = process; this.job = job; this.lease = lease;
        process.EnableRaisingEvents = true;
        process.Exited += (_, _) => { if (!disposed) UnexpectedExit?.Invoke(); };
        // Never retain stdout: it carries a one-time pairing secret.
        stderr = ReadDiagnostics();
    }
    async Task ReadDiagnostics()
    {
        var reader = process.StandardError;
        while (await reader.ReadLineAsync() is { } line)
        {
            lock (diagnostics)
            {
                diagnostics.Enqueue(line.Length > 512 ? line[..512] + "…" : line);
                while (diagnostics.Count > 12) diagnostics.Dequeue();
            }
        }
    }
    public static async Task<ServiceHost> StartAsync(string node, string entry, string database)
    {
        if (!Path.IsPathFullyQualified(node) || !Path.IsPathFullyQualified(entry) || !Path.IsPathFullyQualified(database)) throw new ArgumentException("Absolute paths required");
        if (!File.Exists(node) || !File.Exists(entry)) throw new FileNotFoundException("原生应用文件不完整，请重新构建或解压整个目录。");
        Directory.CreateDirectory(Path.GetDirectoryName(database)!);
        FileStream lease;
        try { lease = new(database + ".desktop.lock", FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None, 1, FileOptions.DeleteOnClose); }
        catch (IOException e) { throw new IOException("该数据库已在另一个 Team 窗口打开，或目录不可写。", e); }
        ProcessJob? job = null; Process? process = null; ServiceHost? host = null;
        try
        {
            job = new();
            var start = new ProcessStartInfo(node) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, WorkingDirectory = Path.GetDirectoryName(entry)! };
            start.ArgumentList.Add(entry); start.Environment.Clear();
            foreach (var name in new[] { "SystemRoot", "WINDIR", "TEMP", "TMP" }) if (Environment.GetEnvironmentVariable(name) is { } value) start.Environment[name] = value;
            start.Environment["CORE_DB"] = database;
            process = Process.Start(start) ?? throw new IOException("无法启动本地服务。");
            job.Add(process.Handle); // The entry does not touch the DB until this succeeds.
            host = new(process, job, lease);
            await process.StandardInput.WriteLineAsync("start"); await process.StandardInput.FlushAsync();
            var line = await process.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(15));
            if (line is null) { await host.stderr.WaitAsync(TimeSpan.FromSeconds(2)); throw new IOException("本地服务启动失败。" + Environment.NewLine + host.Diagnostic); }
            using var doc = JsonDocument.Parse(line); var hello = doc.RootElement;
            if (hello.GetProperty("protocol").GetString() != "desktop/1" || hello.GetProperty("host").GetString() != "127.0.0.1" || hello.GetProperty("native_dispatch").GetBoolean()) throw new InvalidDataException("Unexpected desktop handshake");
            host.Port = hello.GetProperty("port").GetInt32();
            if (host.Port is < 1 or > 65535) throw new InvalidDataException("Invalid port");
            host.Api = new(host.Port);
            await host.Api.PairAsync(hello.GetProperty("code").GetString() ?? throw new InvalidDataException("Missing pairing code"));
            return host;
        }
        catch
        {
            if (host is not null) await host.DisposeAsync();
            else { if (process is not null) { try { if (!process.HasExited) process.Kill(); } catch (InvalidOperationException) { } process.Dispose(); } job?.Dispose(); lease.Dispose(); }
            throw;
        }
    }
    public async ValueTask DisposeAsync()
    {
        if (disposed) return; disposed = true;
        try
        {
            if (!process.HasExited)
            {
                try { if (Api is not null) await Api.LogoutAsync().WaitAsync(TimeSpan.FromSeconds(1)); } catch (Exception e) when (e is HttpRequestException or TimeoutException or TaskCanceledException or ApiException) { /* Child still stopped below. */ }
                try { await process.StandardInput.WriteLineAsync("stop"); await process.StandardInput.FlushAsync(); process.StandardInput.Close(); } catch (IOException) { }
                try { await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(3)); } catch (TimeoutException) { job.Dispose(); await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(3)); }
            }
        }
        finally { job.Dispose(); Api?.Dispose(); lease.Dispose(); process.Dispose(); }
        await stderr;
    }
}


