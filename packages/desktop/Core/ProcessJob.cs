using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
namespace Team.Core;

// Process lifetime containment only; not a security sandbox or Agent isolation claim.
internal sealed class ProcessJob : IDisposable
{
    readonly SafeFileHandle handle;
    public ProcessJob()
    {
        handle = CreateJobObject(IntPtr.Zero, null);
        if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
        var limits = new ExtendedLimits(); limits.Basic.LimitFlags = 0x2000; // KILL_ON_JOB_CLOSE
        if (!SetInformationJobObject(handle, 9, ref limits, (uint)Marshal.SizeOf<ExtendedLimits>())) { var code = Marshal.GetLastWin32Error(); handle.Dispose(); throw new Win32Exception(code); }
    }
    public void Add(IntPtr process) { if (!AssignProcessToJobObject(handle, process)) throw new Win32Exception(Marshal.GetLastWin32Error()); }
    public void Terminate(uint code = 1) { if (!TerminateJobObject(handle, code)) throw new Win32Exception(Marshal.GetLastWin32Error()); }
    public uint ActiveProcesses { get { if (!QueryInformationJobObject(handle, 1, out var info, (uint)Marshal.SizeOf<BasicAccounting>(), IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error()); return info.ActiveProcesses; } }
    public void Dispose() => handle.Dispose();
    [StructLayout(LayoutKind.Sequential)] struct BasicAccounting { public long UserTime, KernelTime, PeriodUserTime, PeriodKernelTime; public uint PageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses; }
    [DllImport("kernel32.dll", SetLastError = true)][return: MarshalAs(UnmanagedType.Bool)] static extern bool TerminateJobObject(SafeFileHandle job, uint code);
    [DllImport("kernel32.dll", SetLastError = true)][return: MarshalAs(UnmanagedType.Bool)] static extern bool QueryInformationJobObject(SafeFileHandle job, int type, out BasicAccounting info, uint size, IntPtr length);
    [StructLayout(LayoutKind.Sequential)] struct BasicLimits { public long ProcessTime, JobTime; public uint LimitFlags; public UIntPtr MinimumWorkingSet, MaximumWorkingSet; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes; }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits { public BasicLimits Basic; public IoCounters Io; public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern SafeFileHandle CreateJobObject(IntPtr attributes, string? name);
    [DllImport("kernel32.dll", SetLastError = true)][return: MarshalAs(UnmanagedType.Bool)] static extern bool SetInformationJobObject(SafeFileHandle job, int type, ref ExtendedLimits info, uint size);
    [DllImport("kernel32.dll", SetLastError = true)][return: MarshalAs(UnmanagedType.Bool)] static extern bool AssignProcessToJobObject(SafeFileHandle job, IntPtr process);
}
