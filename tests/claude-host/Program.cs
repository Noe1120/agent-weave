using System.ComponentModel;
using System.Diagnostics;
using System.Text.Json;
using System.Text;
using System.Runtime.InteropServices;
using Team.Core;

// Acceptance helper only. It holds the actual launched process handle, independently
// of pipe EOF and Job accounting. No attachment, persisted-PID kill or OS isolation.
internal static class Program
{
    [DllImport("shell32.dll", CharSet=CharSet.Unicode)] static extern int SHGetFolderPath(IntPtr hwnd, int folder, IntPtr token, uint flags, StringBuilder path);
    static string KnownFolder(int folder) { var value = new StringBuilder(260); var hr = SHGetFolderPath(IntPtr.Zero, folder, IntPtr.Zero, 0, value); return hr == 0 ? value.ToString() : "HRESULT_" + hr.ToString("X8"); }
    static void Emit(object value) { Console.WriteLine(JsonSerializer.Serialize(value)); Console.Out.Flush(); }
    static string Field(JsonElement input, string name) => input.GetProperty(name).GetString() ?? throw new InvalidDataException("CONFIG_FIELD");
    static async Task<int> Main(string[] args)
    {
        Console.InputEncoding = new UTF8Encoding(false, true);
        Console.OutputEncoding = new UTF8Encoding(false, true);
        if (args.SequenceEqual(new[]{"--known-folders"})) { Emit(new { roaming = KnownFolder(0x1a), local = KnownFolder(0x1c) }); return 0; }
        using var control = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false, true));
        Process? root = null;
        using var job = new ProcessJob();
        bool rootExited = false, jobEmpty = false;
        string? fault = null;
        Task<string?>[] pumps = [];
        var stop = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        try
        {
            var line = await control.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(5));
            if (line is null || line.Length > 65536) throw new InvalidDataException("CONFIG_SIZE");
            using var doc = JsonDocument.Parse(line); var config = doc.RootElement;
            var exe = Field(config, "executable"); var cwd = Field(config, "cwd"); var output = Field(config, "output");
            if (!Path.IsPathFullyQualified(exe) || !Path.IsPathFullyQualified(cwd) || !Path.IsPathFullyQualified(output)) throw new InvalidDataException("CONFIG_PATH");
            var timeout = config.GetProperty("timeout_ms").GetInt32();
            if (timeout < 100 || timeout > 600000) throw new InvalidDataException("CONFIG_TIMEOUT");
            var start = new ProcessStartInfo(exe) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, WorkingDirectory = cwd };
            foreach (var arg in config.GetProperty("args").EnumerateArray()) start.ArgumentList.Add(arg.GetString() ?? throw new InvalidDataException("CONFIG_ARG"));
            start.Environment.Clear();
            foreach (var item in config.GetProperty("env").EnumerateObject()) start.Environment.Add(item.Name, item.Value.GetString());
            // Open diagnostic files before launch. They stay local and bounded.
            using var stdout = new FileStream(Path.Combine(output,"stdout.local.log"), FileMode.CreateNew, FileAccess.Write, FileShare.Read);
            using var stderr = new FileStream(Path.Combine(output,"stderr.local.log"), FileMode.CreateNew, FileAccess.Write, FileShare.Read);
            root = Process.Start(start) ?? throw new InvalidOperationException("SPAWN");
            _ = root.Handle; // Retained until observed exit and cleanup report.
            pumps = [Pump(root.StandardOutput.BaseStream, stdout, "stdout", stop), Pump(root.StandardError.BaseStream, stderr, "stderr", stop)];
            root.StandardInput.Close();
            job.Add(root.Handle); // Assign the actual process; never infer membership from a launcher.
            if (job.ActiveProcesses == 0) throw new InvalidOperationException("JOB_ASSIGNMENT_UNCONFIRMED");
            Emit(new { kind = "started", pid = root.Id, root_handle_retained = true, job_assigned = true });
            _ = Controls(control, stop);
            var watch = Stopwatch.StartNew();
            while (!root.HasExited && !stop.Task.IsCompleted && watch.ElapsedMilliseconds < timeout) await Task.Delay(25);
            var reason = stop.Task.IsCompletedSuccessfully ? stop.Task.Result : root.HasExited ? "ROOT_EXIT" : "DEADLINE";
            if (reason is "OUTPUT_LIMIT" or "OUTPUT_FAILURE" or "CONTROL_FAILURE") fault = reason;
            job.Terminate();
            if (!root.HasExited) root.Kill(); // Exact owned handle, even if accounting disagrees.
            rootExited = root.WaitForExit(5000);
            watch.Restart();
            while (job.ActiveProcesses != 0 && watch.ElapsedMilliseconds < 5000) await Task.Delay(25);
            jobEmpty = job.ActiveProcesses == 0;
            if (!rootExited || !jobEmpty) throw new InvalidOperationException("CLEANUP_UNCONFIRMED");
            var pumpFaults = await Task.WhenAll(pumps).WaitAsync(TimeSpan.FromSeconds(5));
            fault ??= pumpFaults.FirstOrDefault(item => item is not null);
            Emit(new { kind = "exited", root_exit_observed = rootExited, root_exit_code = root.ExitCode, job_empty = jobEmpty, reason, fault });
            return fault is null ? 0 : 1;
        }
        catch (Exception ex)
        {
            fault = ex is InvalidDataException ? ex.Message : ex is Win32Exception win ? "WIN32_" + win.NativeErrorCode : ex.GetType().Name;
            // A failed startup still owns its retained handle. Cleanup failure remains visible.
            try { job.Terminate(); if (root is not null) { if (!root.HasExited) root.Kill(); rootExited = root.WaitForExit(5000); } jobEmpty = job.ActiveProcesses == 0; }
            catch (Exception cleanup) { fault += ":CLEANUP_" + cleanup.GetType().Name; }
            Emit(new { kind = "fault", code = fault, root_exit_observed = rootExited, job_empty = jobEmpty });
            return 1;
        }
        finally { root?.Dispose(); }
    }
    static async Task<string?> Pump(Stream input, Stream output, string channel, TaskCompletionSource<string> stop)
    {
        byte[] buffer = new byte[4096]; int total = 0;
        try
        {
            int n;
            while ((n = await input.ReadAsync(buffer)) != 0)
            {
                if (total + n > 65536) { stop.TrySetResult("OUTPUT_LIMIT"); return "OUTPUT_LIMIT"; }
                await output.WriteAsync(buffer.AsMemory(0,n)); await output.FlushAsync();
                if (total == 0) Emit(new { kind = "output", channel, bytes = n });
                total += n;
            }
        }
        catch (Exception) { stop.TrySetResult("OUTPUT_FAILURE"); return "OUTPUT_FAILURE"; }
        return null;
    }
    static async Task Controls(StreamReader control, TaskCompletionSource<string> stop)
    {
        try
        {
            var line = await control.ReadLineAsync();
            if (line is null) { stop.TrySetResult("CONTROLLER_EOF"); return; }
            if (line.Length > 4096) throw new InvalidDataException();
            using var doc = JsonDocument.Parse(line);
            stop.TrySetResult(Field(doc.RootElement,"kind") == "stop" ? "CONTROLLER_STOP" : "CONTROL_FAILURE");
        }
        catch (Exception) { stop.TrySetResult("CONTROL_FAILURE"); }
    }
}
