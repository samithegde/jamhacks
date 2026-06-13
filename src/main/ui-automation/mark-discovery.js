const { execFile } = require("child_process");
const { screen } = require("electron");
const { MARK_SOURCES, MAX_MARKS, MIN_MARK_SIZE } = require("../../shared/localization-types");

const UIA_MIN_MARKS = 8;
const GRID_COLUMNS = 12;
const GRID_ROWS = 8;

function runPowerShellJson(script, timeout = 2500) {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { timeout, maxBuffer: 1024 * 1024 * 4 },
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
  });
}

function getPrimaryDisplayBounds() {
  const display = screen.getPrimaryDisplay();
  const scale = display.scaleFactor || 1;
  const bounds = display.bounds;

  return {
    x: Math.round(bounds.x * scale),
    y: Math.round(bounds.y * scale),
    width: Math.round(bounds.width * scale),
    height: Math.round(bounds.height * scale),
    scaleFactor: scale,
  };
}

function normalizeMark(mark, source = MARK_SOURCES.UIA) {
  const x = Math.round(Number(mark?.x));
  const y = Math.round(Number(mark?.y));
  const w = Math.round(Number(mark?.w));
  const h = Math.round(Number(mark?.h));

  if (![x, y, w, h].every(Number.isFinite) || w < MIN_MARK_SIZE || h < MIN_MARK_SIZE) {
    return null;
  }

  return {
    x,
    y,
    w,
    h,
    label: String(mark?.label ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
    controlType: String(mark?.controlType ?? "").trim(),
    automationId: String(mark?.automationId ?? "").trim(),
    source,
  };
}

function area(mark) {
  return mark.w * mark.h;
}

function iou(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (!intersection) return 0;
  return intersection / (area(a) + area(b) - intersection);
}

function dedupeMarks(marks) {
  const sorted = [...marks].sort((a, b) => area(a) - area(b));
  const result = [];

  for (const mark of sorted) {
    if (result.some((existing) => iou(existing, mark) > 0.7)) continue;
    result.push(mark);
    if (result.length >= MAX_MARKS) break;
  }

  return result.map((mark, index) => ({ id: index + 1, ...mark }));
}

function createGridMarks(displayBounds) {
  const cellW = Math.max(MIN_MARK_SIZE, Math.floor(displayBounds.width / GRID_COLUMNS));
  const cellH = Math.max(MIN_MARK_SIZE, Math.floor(displayBounds.height / GRID_ROWS));
  const marks = [];

  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLUMNS; col += 1) {
      marks.push({
        x: displayBounds.x + col * cellW,
        y: displayBounds.y + row * cellH,
        w: col === GRID_COLUMNS - 1
          ? displayBounds.width - col * cellW
          : cellW,
        h: row === GRID_ROWS - 1
          ? displayBounds.height - row * cellH
          : cellH,
        label: "",
        source: MARK_SOURCES.GRID,
      });
    }
  }

  return marks;
}

async function discoverUiaMarks() {
  if (process.platform !== "win32") return [];

  const script = `
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$controlTypes = @(
  [System.Windows.Automation.ControlType]::Button,
  [System.Windows.Automation.ControlType]::Hyperlink,
  [System.Windows.Automation.ControlType]::MenuItem,
  [System.Windows.Automation.ControlType]::TabItem,
  [System.Windows.Automation.ControlType]::CheckBox,
  [System.Windows.Automation.ControlType]::ComboBox,
  [System.Windows.Automation.ControlType]::Edit,
  [System.Windows.Automation.ControlType]::ListItem,
  [System.Windows.Automation.ControlType]::RadioButton,
  [System.Windows.Automation.ControlType]::TreeItem,
  [System.Windows.Automation.ControlType]::DataItem
)

$conditions = @()
foreach ($type in $controlTypes) {
  $conditions += [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    $type
  )
}
$condition = [System.Windows.Automation.OrCondition]::new([System.Windows.Automation.Condition[]]$conditions)
$elements = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
  [System.Windows.Automation.TreeScope]::Descendants,
  $condition
)

$marks = New-Object System.Collections.Generic.List[object]
$max = [Math]::Min($elements.Count, 1200)
for ($i = 0; $i -lt $max; $i++) {
  $el = $elements.Item($i)
  $current = $el.Current
  $rect = $current.BoundingRectangle
  if (-not $current.IsEnabled) { continue }
  if ($rect.IsEmpty -or $rect.Width -lt 8 -or $rect.Height -lt 8) { continue }
  if (-not $current.IsKeyboardFocusable -and $rect.Width * $rect.Height -lt 256) { continue }

  $marks.Add([pscustomobject]@{
    x = [int][Math]::Round($rect.X)
    y = [int][Math]::Round($rect.Y)
    w = [int][Math]::Round($rect.Width)
    h = [int][Math]::Round($rect.Height)
    label = [string]$current.Name
    automationId = [string]$current.AutomationId
    controlType = [string]$current.ControlType.ProgrammaticName
  })
}

$marks | ConvertTo-Json -Compress
`;

  try {
    const marks = await runPowerShellJson(script);
    return (Array.isArray(marks) ? marks : [marks])
      .map((mark) => normalizeMark(mark, MARK_SOURCES.UIA))
      .filter(Boolean);
  } catch (error) {
    console.warn("[localization] UIA mark discovery failed:", error.message);
    return [];
  }
}

async function discoverMarks() {
  const displayBounds = getPrimaryDisplayBounds();
  const uiaMarks = await discoverUiaMarks();
  const sourceMarks =
    uiaMarks.length >= UIA_MIN_MARKS
      ? uiaMarks
      : [...uiaMarks, ...createGridMarks(displayBounds)];

  return {
    marks: dedupeMarks(sourceMarks),
    displayBounds,
  };
}

module.exports = {
  discoverMarks,
  createGridMarks,
};
