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

function restoreWindowsTaskbar() {
  if (process.platform !== "win32") return Promise.resolve();

  return runPowerShell(`
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public class OverlayTaskbar {
  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string c, string w);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  public static void Show() {
    ShowWindow(FindWindow("Shell_TrayWnd", null), 5);
    ShowWindow(FindWindow("Shell_SecondaryTrayWnd", null), 5);
  }
}
"@
    [OverlayTaskbar]::Show()
  `).catch(() => {});
}

module.exports = { restoreWindowsTaskbar };
