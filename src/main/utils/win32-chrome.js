const { execFile } = require("child_process");

let chromeReady = null;

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

function ensureWin32Chrome() {
  if (process.platform !== "win32") return Promise.resolve();
  if (!chromeReady) {
    chromeReady = runPowerShell(`
      Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Chrome {
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  const int GWL_EXSTYLE = -20;
  const int WS_EX_NOREDIRECTIONBITMAP = 0x00200000;
  const uint SWP_FRAMECHANGED = 0x0020;
  const uint SWP_NOMOVE = 0x0002;
  const uint SWP_NOSIZE = 0x0001;
  const uint SWP_NOZORDER = 0x0004;
  public static void SetNoRedirectionBitmap(IntPtr hWnd) {
    var style = GetWindowLong(hWnd, GWL_EXSTYLE);
    SetWindowLong(hWnd, GWL_EXSTYLE, style | WS_EX_NOREDIRECTIONBITMAP);
    SetWindowPos(hWnd, IntPtr.Zero, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED);
  }
}
"@
    `).catch(() => {});
  }
  return chromeReady;
}

function setNoRedirectionBitmap(window) {
  if (process.platform !== "win32") return Promise.resolve();

  const hwnd = getNativeHwnd(window);
  if (hwnd === null) return Promise.resolve();

  return ensureWin32Chrome()
    .then(() =>
      runPowerShell(`[Win32Chrome]::SetNoRedirectionBitmap([IntPtr]${hwnd})`).catch(() => {})
    );
}

module.exports = { setNoRedirectionBitmap };
