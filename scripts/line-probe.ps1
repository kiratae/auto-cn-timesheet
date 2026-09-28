# Supervised probe of LINE for Windows' UI, used once to design scripts/line-export.ps1.
#   Phase A: powershell -File scripts/line-probe.ps1 -Chat P_CH -OutDir <dir>
#            opens the chat through the search box, then screenshots + dumps the UI tree. Clicks nothing in the chat.
#   Phase B: powershell -File scripts/line-probe.ps1 -Chat P_CH -OutDir <dir> -MenuX <x> -MenuY <y>
#            same, then clicks ONLY the given screen point (the chat menu button, found from phase A's screenshot)
#            and dumps the menu that opens. Then Esc.
# Safety: text goes in only via UI Automation ValuePattern.SetValue on the search box; the only key sent is Esc.
param(
  [Parameter(Mandatory)] [string] $Chat,
  [Parameter(Mandatory)] [string] $OutDir,
  [int] $MenuX = -1,
  [int] $MenuY = -1,
  [switch] $OpenMenu, # Phase B by rule: rightmost LcButton in the ChatWindow header (never the call button, an LcImage)
  [switch] $ClickSave # Phase C: click the item after the checkable "Keep window on top", dump the Save dialog, then CANCEL it
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing, System.Windows.Forms
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class W32 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
}
"@
$UIA = [System.Windows.Automation.AutomationElement]
$Scope = [System.Windows.Automation.TreeScope]
New-Item -ItemType Directory -Force $OutDir | Out-Null

function Shot($name) {
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
  $bmp.Save((Join-Path $OutDir "$name.png"), [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()
}
function Dump($el, $name) {
  $lines = New-Object System.Collections.Generic.List[string]
  function Walk($e, $depth) {
    $c = $e.Current
    $pats = ($e.GetSupportedPatterns() | ForEach-Object { $_.ProgrammaticName -replace 'PatternIdentifiers.Pattern', '' }) -join ','
    $lines.Add(("  " * $depth) + "[$($c.ControlType.ProgrammaticName -replace 'ControlType.','')] name='$($c.Name)' id='$($c.AutomationId)' class='$($c.ClassName)' rect=$($c.BoundingRectangle) patterns=$pats")
    if ($depth -lt 12) { foreach ($ch in $e.FindAll($Scope::Children, [System.Windows.Automation.Condition]::TrueCondition)) { Walk $ch ($depth + 1) } }
  }
  Walk $el 0
  [IO.File]::WriteAllLines((Join-Path $OutDir "$name.txt"), $lines, [Text.Encoding]::UTF8)
}
function LineWindows {
  $procs = Get-Process -Name LINE -ErrorAction SilentlyContinue
  if (-not $procs) { throw "LINE is not running" }
  $cond = New-Object System.Windows.Automation.OrCondition(@($procs | ForEach-Object { New-Object System.Windows.Automation.PropertyCondition($UIA::ProcessIdProperty, $_.Id) }) + @([System.Windows.Automation.Condition]::FalseCondition))
  $UIA::RootElement.FindAll($Scope::Children, $cond)
}
function Esc { [System.Windows.Forms.SendKeys]::SendWait("{ESC}") }
# LINE's Qt widgets accept UIA Invoke() but ignore it, so click the centre of an element UIA located.
function ClickEl($el) {
  $r = $el.Current.BoundingRectangle
  [W32]::SetCursorPos([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2)) | Out-Null; Start-Sleep -Milliseconds 120
  [W32]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero); [W32]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
}

# 1. Main window to the front
$main = LineWindows | Where-Object { $_.Current.ClassName -eq "AllInOneWindow" } | Select-Object -First 1
if (-not $main) { throw "LINE main window (AllInOneWindow) not found" }
$h = [IntPtr]$main.Current.NativeWindowHandle
[W32]::ShowWindow($h, 9) | Out-Null; [W32]::SetForegroundWindow($h) | Out-Null; Start-Sleep -Milliseconds 600
$before = @(LineWindows | ForEach-Object { $_.Current.NativeWindowHandle })
Shot "a0-main"; Dump $main "a0-main"

# 1b. The chat list may be filtered to a folder tab (e.g. "Groups"); select the first tab ("All") so 1:1 chats show up.
#     Elements have no names, but Qt class names are stable: tabs are TabButton > LcCheckBox.
$byClass = { param($root, $cls) $root.FindAll($Scope::Descendants, (New-Object System.Windows.Automation.PropertyCondition($UIA::ClassNameProperty, $cls))) }
$firstTab = & $byClass $main "TabButton" | Sort-Object { $_.Current.BoundingRectangle.X } | Select-Object -First 1
if ($firstTab) {
  $box = $firstTab.FindFirst($Scope::Children, (New-Object System.Windows.Automation.PropertyCondition($UIA::ClassNameProperty, "LcCheckBox")))
  $r = $box.Current.BoundingRectangle
  "All tab at $r"
  ClickEl $box; "clicked All tab"
  Start-Sleep -Milliseconds 700
  Shot "a0b-alltab"
}

# 2. Search for the chat (ValuePattern only; no typing)
$edit = $main.FindFirst($Scope::Descendants, (New-Object System.Windows.Automation.PropertyCondition($UIA::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)))
if (-not $edit) { throw "search box not found (LINE locked or logged out?)" }
$edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($Chat)
Start-Sleep -Milliseconds 1200
Shot "a1-search"; Dump $main "a1-search"

# 3. Open the first result
# Result list = section headers ("Chats 10", "Messages 4", ~34px tall) + chat rows (~71px). Take the first chat row.
$items = $main.FindAll($Scope::Descendants, (New-Object System.Windows.Automation.PropertyCondition($UIA::ControlTypeProperty, [System.Windows.Automation.ControlType]::ListItem)))
$items | ForEach-Object { "  list item $($_.Current.BoundingRectangle)" }
$item = $items | Where-Object { $_.Current.BoundingRectangle.Height -ge 50 } | Select-Object -First 1
if (-not $item) { throw "no search result for '$Chat'" }
"first result at $($item.Current.BoundingRectangle)"
# Single click only selects the row (into the collapsed right pane); double-click opens the chat in its own window.
ClickEl $item; Start-Sleep -Milliseconds 90; ClickEl $item
Start-Sleep -Milliseconds 1800
Shot "a2-chat"
$i = 0
foreach ($w in LineWindows) {
  $new = -not ($before -contains $w.Current.NativeWindowHandle)
  "window class='$($w.Current.ClassName)' name='$($w.Current.Name)' new=$new rect=$($w.Current.BoundingRectangle)"
  Dump $w ("a2-window{0}-{1}" -f $i, $w.Current.ClassName); $i++
}

# 4. Phase B only: open the chat menu, dump what appears
if ($OpenMenu) {
  $chatWin = LineWindows | Where-Object { $_.Current.ClassName -eq "ChatWindow" -and $_.Current.Name -eq $Chat } | Select-Object -First 1
  if (-not $chatWin) { throw "ChatWindow '$Chat' not found" }
  $panel = & $byClass $chatWin "ChatMessagePanel" | Select-Object -First 1
  $header = $panel.FindFirst($Scope::Children, [System.Windows.Automation.Condition]::TrueCondition)
  $buttons = $header.FindAll($Scope::Children, (New-Object System.Windows.Automation.PropertyCondition($UIA::ClassNameProperty, "LcButton")))
  $menuBtn = $buttons | Sort-Object { $_.Current.BoundingRectangle.X } | Select-Object -Last 1
  "header buttons: $(($buttons | ForEach-Object { $_.Current.BoundingRectangle.X }) -join ', '); menu button at $($menuBtn.Current.BoundingRectangle)"
  ClickEl $menuBtn
  Start-Sleep -Milliseconds 900
}
if ($MenuX -ge 0 -and $MenuY -ge 0) {
  [W32]::SetCursorPos($MenuX, $MenuY) | Out-Null; Start-Sleep -Milliseconds 150
  [W32]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero); [W32]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 900
}
if ($OpenMenu -or ($MenuX -ge 0 -and $MenuY -ge 0)) {
  Shot "b0-menu"
  $i = 0
  foreach ($w in LineWindows) { Dump $w ("b0-window{0}-{1}" -f $i, $w.Current.ClassName); $i++ }
  $menu = LineWindows | Where-Object { $_.Current.ClassName -eq "LcContextMenu" } | Select-Object -First 1
  $entries = @($menu.FindAll($Scope::Descendants, [System.Windows.Automation.Condition]::TrueCondition) |
    Where-Object { $_.Current.ClassName -in "LcContextMenuItem", "LcCheckableContextMenuItem" } |
    Sort-Object { $_.Current.BoundingRectangle.Y })
  "menu items (class @ y): " + (($entries | ForEach-Object { "$($_.Current.ClassName -replace 'ContextMenuItem','')@$($_.Current.BoundingRectangle.Y)" }) -join ", ")
  $anchor = [Array]::FindIndex([object[]]$entries, [Predicate[object]] { param($e) $e.Current.ClassName -eq "LcCheckableContextMenuItem" })
  "checkable item index: $anchor; 'Save chat' should be index $($anchor + 1) at $($entries[$anchor + 1].Current.BoundingRectangle)"
  if ($ClickSave -and $anchor -ge 0) {
    ClickEl $entries[$anchor + 1]
    Start-Sleep -Milliseconds 1500
    Shot "c0-savedialog"
    $chatWin = LineWindows | Where-Object { $_.Current.ClassName -eq "ChatWindow" -and $_.Current.Name -eq $Chat } | Select-Object -First 1
    $viaQt = $chatWin.FindFirst($Scope::Children, (New-Object System.Windows.Automation.PropertyCondition($UIA::ClassNameProperty, "#32770")))
    "dialog via chat window: $([bool]$viaQt)"
    # Re-read it from its native handle so the standard dialog's own (Win32) UIA provider exposes its controls.
    $dlg = if ($viaQt) { $UIA::FromHandle([IntPtr]$viaQt.Current.NativeWindowHandle) }
    if ($dlg) {
      Dump $viaQt "c0-savedialog-viaQt"
      Dump $dlg "c0-savedialog"
      $name = $dlg.FindFirst($Scope::Descendants, (New-Object System.Windows.Automation.AndCondition(
        (New-Object System.Windows.Automation.PropertyCondition($UIA::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)),
        (New-Object System.Windows.Automation.PropertyCondition($UIA::AutomationIdProperty, "1001")))))
      "save dialog title='$($dlg.Current.Name)' default file name='$(if ($name) { $name.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value })'"
      [W32]::SetForegroundWindow([IntPtr]$dlg.Current.NativeWindowHandle) | Out-Null
    } else { "no #32770 dialog appeared" }
  }
  Esc; Start-Sleep -Milliseconds 300 # closes the menu, or cancels the Save dialog
}
"done: outputs in $OutDir"
