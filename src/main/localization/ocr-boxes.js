const { execFile } = require("child_process");

function levenshtein(a, b) {
  const left = String(a ?? "").toLowerCase();
  const right = String(b ?? "").toLowerCase();
  const dp = Array.from({ length: left.length + 1 }, () =>
    new Array(right.length + 1).fill(0)
  );

  for (let i = 0; i <= left.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= right.length; j += 1) dp[0][j] = j;

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[left.length][right.length];
}

function normalizeText(text) {
  return String(text ?? "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function scoreCandidate(candidateText, targetText) {
  const candidate = normalizeText(candidateText);
  const target = normalizeText(targetText);
  if (!candidate || !target) return 0;
  if (candidate === target) return 1;
  if (candidate.includes(target) || target.includes(candidate)) return 0.9;
  if (levenshtein(candidate, target) <= 2) return 0.8;
  return 0;
}

function runPowerShellJson(script, inputBase64, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { timeout, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }

        try {
          resolve(JSON.parse(stdout || "[]"));
        } catch (parseError) {
          reject(parseError);
        }
      }
    );

    child.stdin.end(inputBase64);
  });
}

async function readWindowsOcrBoxes(base64) {
  if (process.platform !== "win32" || !base64) return [];

  const script = `
$ErrorActionPreference = "Stop"
$inputText = [Console]::In.ReadToEnd()
Add-Type -AssemblyName System.Runtime.WindowsRuntime
try {
  [void][Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
  [void][Windows.Storage.Streams.DataWriter, Windows.Storage.Streams, ContentType = WindowsRuntime]
  [void][Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime]
  [void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
  [void][Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
} catch {
  @() | ConvertTo-Json -Compress
  exit 0
}

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() |
  Where-Object { $_.Name -eq "AsTask" -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1 })[0]

function Await-Operation($operation, $resultType) {
  $task = $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($operation))
  $task.Wait()
  return $task.Result
}

try {
  $cleanBase64 = $inputText.Trim()
  $comma = $cleanBase64.IndexOf(",")
  if ($comma -ge 0) {
    $cleanBase64 = $cleanBase64.Substring($comma + 1)
  }

  $bytes = [Convert]::FromBase64String($cleanBase64)
  $stream = [Windows.Storage.Streams.InMemoryRandomAccessStream]::new()
  $writer = [Windows.Storage.Streams.DataWriter]::new($stream)
  $writer.WriteBytes($bytes)
  [void](Await-Operation $writer.StoreAsync() ([UInt32]))
  [void](Await-Operation $writer.FlushAsync() ([Boolean]))
  [void]$writer.DetachStream()
  $stream.Seek(0)

  $decoder = Await-Operation ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await-Operation ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  if ($null -eq $engine) {
    @() | ConvertTo-Json -Compress
    exit 0
  }

  $result = Await-Operation ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  $boxes = New-Object System.Collections.Generic.List[object]
  foreach ($line in $result.Lines) {
    foreach ($word in $line.Words) {
      $rect = $word.BoundingRect
      $boxes.Add([pscustomobject]@{
        text = [string]$word.Text
        x = [int][Math]::Round($rect.X)
        y = [int][Math]::Round($rect.Y)
        w = [int][Math]::Round($rect.Width)
        h = [int][Math]::Round($rect.Height)
      })
    }
  }

  $boxes | ConvertTo-Json -Compress
} catch {
  Write-Error $_
  exit 1
}
`;

  try {
    const boxes = await runPowerShellJson(script, base64);
    return Array.isArray(boxes) ? boxes : [];
  } catch (error) {
    console.warn("[localization] OCR unavailable:", error.message);
    return [];
  }
}

async function getOcrCandidates({ croppedBase64, targetText } = {}) {
  const rawBoxes = await readWindowsOcrBoxes(croppedBase64);
  const candidates = rawBoxes
    .map((box) => ({
      text: String(box?.text ?? "").trim(),
      x: Math.round(Number(box?.x)),
      y: Math.round(Number(box?.y)),
      w: Math.round(Number(box?.w)),
      h: Math.round(Number(box?.h)),
    }))
    .filter((box) =>
      box.text &&
      [box.x, box.y, box.w, box.h].every(Number.isFinite) &&
      box.w > 0 &&
      box.h > 0
    )
    .map((box) => ({
      ...box,
      score: scoreCandidate(box.text, targetText),
    }))
    .filter((box) => !targetText || box.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const exact = candidates.find((box) => box.score >= 0.95);
  return {
    candidates,
    fastPath: exact
      ? {
          x: Math.round(exact.x + exact.w / 2),
          y: Math.round(exact.y + exact.h / 2),
          text: exact.text,
          method: "ocr",
        }
      : null,
  };
}

module.exports = {
  getOcrCandidates,
  scoreCandidate,
};
