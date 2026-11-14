using System.Diagnostics;
using System.Text;
using System.Text.Json;
using Team.Core;

// Trusted development fixture only: cooperative bootstrap precedes Job assignment.
// This is owned-process lifetime containment, never an attached-client sandbox.
internal static class Program
{
    static readonly object OutputLock = new();
    static readonly UTF8Encoding Utf8 = new(false, true);
    static void Emit(object message) { lock (OutputLock) Console.WriteLine(JsonSerializer.Serialize(message)); }
    static async IAsyncEnumerable<string> Lines(Stream stream, int limit)
    {
        byte[] block = new byte[4096]; using var line = new MemoryStream();
        int read;
        while ((read = await stream.ReadAsync(block)) != 0)
            for (int i = 0; i < read; i++)
            {
                if (block[i] == 10) { yield return Utf8.GetString(line.GetBuffer(), 0, (int)line.Length).TrimEnd('\r'); line.SetLength(0); }
                else { if (line.Length >= limit) throw new InvalidDataException("PROTOCOL_FRAME_LIMIT"); line.WriteByte(block[i]); }
            }
        if (line.Length != 0) throw new InvalidDataException("PROTOCOL_UNTERMINATED_FRAME");
    }
    static string Field(JsonElement value, string name) => value.GetProperty(name).GetString() ?? throw new InvalidDataException("HOST_CONFIG");
    public static async Task<int> Main()
    {
        Process? worker = null; ProcessJob? job = null;
        try
        {
            var input = Lines(Console.OpenStandardInput(), 65536).GetAsyncEnumerator();
            if (!await input.MoveNextAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(5))) throw new InvalidDataException("HOST_CONFIG_EOF");
            using var boot = JsonDocument.Parse(input.Current); var config = boot.RootElement;
            var node = Field(config, "node"); var script = Field(config, "worker"); var cwd = Field(config, "cwd");
            if (!Path.IsPathFullyQualified(node) || !Path.IsPathFullyQualified(script) || !Path.IsPathFullyQualified(cwd)) throw new InvalidDataException("HOST_CONFIG_PATH");
            job = new ProcessJob();
            var start = new ProcessStartInfo(node) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, WorkingDirectory = cwd };
            start.ArgumentList.Add(script); start.Environment.Clear();
            start.Environment["SystemRoot"] = Environment.GetEnvironmentVariable("SystemRoot") ?? throw new InvalidDataException("HOST_SYSTEMROOT");
            start.Environment["TEMP"] = cwd; start.Environment["TMP"] = cwd;
            worker = Process.Start(start) ?? throw new InvalidOperationException("HOST_SPAWN");
            try { job.Add(worker.Handle); }
            catch { worker.Kill(true); await worker.WaitForExitAsync(); throw; }
            Emit(new { kind = "started", pid = worker.Id, job_assigned = true });
            await worker.StandardInput.WriteLineAsync(JsonSerializer.Serialize(new { kind = "begin", input = config.GetProperty("input") }));
            await worker.StandardInput.FlushAsync();
            var stop = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
            var stdout = PumpOutput(worker.StandardOutput.BaseStream, stop);
            var stderr = PumpError(worker.StandardError.BaseStream, stop);
            _ = Controls(input, worker, stop);
            var exited = worker.WaitForExitAsync();
            await Task.WhenAny(exited, stop.Task);
            // Even if the main process exited normally, descendants must be reaped.
            job.Terminate();
            await exited.WaitAsync(TimeSpan.FromSeconds(5));
            var watch = Stopwatch.StartNew();
            while (job.ActiveProcesses != 0 && watch.ElapsedMilliseconds < 5000) await Task.Delay(10);
            if (job.ActiveProcesses != 0) throw new InvalidOperationException("HOST_JOB_NOT_EMPTY");
            await Task.WhenAll(stdout, stderr).WaitAsync(TimeSpan.FromSeconds(5));
            Emit(new { kind = "exited", exit_code = worker.ExitCode, job_empty = true, reason = stop.Task.IsCompletedSuccessfully ? stop.Task.Result : null });
            return 0;
        }
        catch (Exception ex)
        {
            // Never promote a cleanup attempt or handle disposal into observed Job-empty proof.
            Emit(new { kind = "fault", code = ex is InvalidDataException ? ex.Message : "HOST_FAILURE" });
            return 1;
        }
        finally { job?.Dispose(); worker?.Dispose(); }
    }
    static async Task PumpOutput(Stream stream, TaskCompletionSource<string> stop)
    {
        int bytes = 0, frames = 0;
        try
        {
            await foreach (var line in Lines(stream, 65536))
            {
                bytes += Utf8.GetByteCount(line); frames++;
                if (bytes > 1048576 || frames > 512) throw new InvalidDataException("PROTOCOL_OUTPUT_LIMIT");
                Emit(new { kind = "worker", line });
            }
        }
        catch (Exception ex) { stop.TrySetResult(ex is InvalidDataException ? ex.Message : ex is DecoderFallbackException ? "PROTOCOL_UTF8" : "HOST_STDOUT_FAILURE"); }
    }
    static async Task PumpError(Stream stream, TaskCompletionSource<string> stop)
    {
        byte[] block = new byte[4096]; int total = 0, read;
        try
        {
            while ((read = await stream.ReadAsync(block)) != 0)
            {
                total += read;
                if (total > 16384) { stop.TrySetResult("STDERR_LIMIT"); return; }
            }
            if (total > 0) Emit(new { kind = "diagnostic", stderr_bytes = total });
        }
        catch (IOException) { stop.TrySetResult("HOST_STDERR_FAILURE"); }
    }
    static async Task Controls(IAsyncEnumerator<string> input, Process worker, TaskCompletionSource<string> stop)
    {
        try
        {
            while (await input.MoveNextAsync())
            {
                using var doc = JsonDocument.Parse(input.Current); var message = doc.RootElement;
                var kind = Field(message, "kind");
                if (kind == "stop") { stop.TrySetResult("CONTROLLER_STOP"); return; }
                if (kind != "ack") { stop.TrySetResult("HOST_CONTROL_PROTOCOL"); return; }
                await worker.StandardInput.WriteLineAsync(input.Current); await worker.StandardInput.FlushAsync();
            }
            stop.TrySetResult("CONTROLLER_EOF");
        }
        catch (Exception) { stop.TrySetResult("HOST_CONTROL_FAILURE"); }
    }
}
