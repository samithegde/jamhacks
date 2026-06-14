const { execFile } = require("child_process");

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      (error) => {
        if (error) reject(error);
        else resolve();
      }
    );
  });
}

function getNativeHwnd(window) {
  if (!window || window.isDestroyed()) return null;
  const handle = window.getNativeWindowHandle();
  if (!handle?.length) return null;
  if (handle.length >= 8) {
    return handle.readBigInt64LE(0);
  }
  return BigInt(handle.readUInt32LE(0));
}

// Each function compiles + executes in one PowerShell process so the type is
// available when the method is called.

function setNoRedirectionBitmap(window) {
  if (process.platform !== "win32") return Promise.resolve();
  const hwnd = getNativeHwnd(window);
  if (hwnd === null) return Promise.resolve();

  return runPowerShell(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32NRB {
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h, int n, int v);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr h2, int x, int y, int cx, int cy, uint f);
  public static void Run(IntPtr h) {
    SetWindowLong(h, -20, GetWindowLong(h, -20) | 0x00200000);
    SetWindowPos(h, IntPtr.Zero, 0, 0, 0, 0, 0x0027);
  }
}
"@
[Win32NRB]::Run([IntPtr]${hwnd.toString()})
  `).catch(() => {});
}

function sendCtrlC() {
  if (process.platform !== "win32") return Promise.resolve();
  return runPowerShell(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Keys {
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, IntPtr extra);
  public static void CtrlC() {
    keybd_event(0x11, 0, 0, IntPtr.Zero);
    keybd_event(0x43, 0, 0, IntPtr.Zero);
    keybd_event(0x43, 0, 2, IntPtr.Zero);
    keybd_event(0x11, 0, 2, IntPtr.Zero);
  }
}
"@
[Win32Keys]::CtrlC()
  `).catch(() => {});
}

module.exports = { setNoRedirectionBitmap, sendCtrlC };
