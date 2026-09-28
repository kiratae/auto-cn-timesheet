# Export LINE chats to "[LINE]<chat>.txt" by driving LINE for Windows' own "Save chat".
# Chat names come from $env:LINE_CHATS_JSON (a JSON array; avoids quoting trouble with Thai/emoji).
# Prints one JSON object per line: {"progress":"..."} while working, then {"result":{...}} or {"error":"..."}.
#
# How it finds things (LINE's Qt UI exposes no element names, so by class + structure; see scripts/line-probe.ps1):
#   main window AllInOneWindow -> chat-list tabs are TabButton (first = "All"; the selected one has a 2px underline)
#   search box = the Edit in AllInOneWindow; results = ListItems (section headers ~34px tall, chat rows ~71px)
#   double-click a chat row -> a ChatWindow whose title is the chat name                       (check #1)
#   chat menu = rightmost LcButton in ChatMessagePanel's header row (the call button is an LcImage, never picked)
#   "Save chat" = the menu item right after the only checkable item ("Keep window on top")
#   Save As dialog (#32770) pre-fills "[LINE]<chat>.txt"; anything else means wrong chat/item -> cancel (check #2)
#
# Safety: text goes in only through UI Automation ValuePattern.SetValue (search box, file-name box). No key presses
# except Esc to back out of a menu/dialog; never Enter, so nothing can be typed or sent into a chat.
param(
  [Parameter(Mandatory)] [string] $OutDir,
  [string] $CancelFile # if this file appears during the countdown, stop without touching LINE
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class W32 {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  // Windows only lets the foreground process move focus. Launched from a background process (bun, the web server)
  // a plain SetForegroundWindow is refused; attaching to the foreground thread's input borrows that right.
  public static bool ForceForeground(IntPtr h) {
    IntPtr fg = GetForegroundWindow();
    if (fg == h) return true;
    uint fgThread = GetWindowThreadProcessId(fg, IntPtr.Zero), me = GetCurrentThreadId();
    bool attached = fgThread != 0 && fgThread != me && AttachThreadInput(me, fgThread, true);
    ShowWindow(h, 9); BringWindowToTop(h); SetForegroundWindow(h);
    if (attached) AttachThreadInput(me, fgThread, false);
    return GetForegroundWindow() == h;
  }
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, string l);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
}
"@
[W32]::SetProcessDPIAware() | Out-Null # UIA reports physical pixels; without this, clicks drift on scaled displays

$UIA = [System.Windows.Automation.AutomationElement]
$Scope = [System.Windows.Automation.TreeScope]
$True_ = [System.Windows.Automation.Condition]::TrueCondition
$t0 = Get-Date

function Emit($obj) { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 5)); [Console]::Out.Flush() }
function Say($text) { Emit @{ progress = $text } }
# (not "Cls": that name is a built-in alias for Clear-Host and would win over a function)
function ByClass($cls) { New-Object System.Windows.Automation.PropertyCondition($UIA::ClassNameProperty, $cls) }
function ByType($t) { New-Object System.Windows.Automation.PropertyCondition($UIA::ControlTypeProperty, $t) }
function Wait($what, [scriptblock] $probe, [int] $ms = 6000) {
  $end = (Get-Date).AddMilliseconds($ms)
  while ((Get-Date) -lt $end) { $r = & $probe; if ($r) { return $r }; Start-Sleep -Milliseconds 150 }
  throw "timed out waiting for $what"
}
function Click($el, [switch] $Double) {
  $r = $el.Current.BoundingRectangle
  if ($r.IsEmpty -or $r.Width -le 0) { throw "element has no on-screen position" }
  $x = [int]($r.X + $r.Width / 2); $y = [int]($r.Y + $r.Height / 2)
  # Safety: only click if the point is really on a LINE window (nothing else covering it), so a click can never
  # land in another app, e.g. when LINE couldn't be brought to the front.
  $p = New-Object W32+POINT; $p.X = $x; $p.Y = $y
  $top = [W32]::GetAncestor([W32]::WindowFromPoint($p), 2) # GA_ROOT
  $lineHandles = @(LineWindows | ForEach-Object { [IntPtr]$_.Current.NativeWindowHandle })
  if (-not ($lineHandles -contains $top)) { throw "something is covering LINE at the click point; not clicking" }
  [W32]::SetCursorPos($x, $y) | Out-Null; Start-Sleep -Milliseconds 100
  foreach ($n in 1..($(if ($Double) { 2 } else { 1 }))) {
    [W32]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero); [W32]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    if ($Double) { Start-Sleep -Milliseconds 80 }
  }
}
function Esc { [System.Windows.Forms.SendKeys]::SendWait("{ESC}") }
function DlgControl($dlg, $cls, $id) {
  $dlg.FindFirst($Scope::Descendants, (New-Object System.Windows.Automation.AndCondition(
    (ByClass $cls), (New-Object System.Windows.Automation.PropertyCondition($UIA::AutomationIdProperty, $id)))))
}
function SetText($edit, $text) { $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($text) }
function GetText($edit) { $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value }
function LineWindows {
  $ids = @(Get-Process -Name LINE -ErrorAction SilentlyContinue | ForEach-Object Id)
  @($UIA::RootElement.FindAll($Scope::Children, $True_) | Where-Object { $ids -contains $_.Current.ProcessId })
}
function Front($win) {
  $h = [IntPtr]$win.Current.NativeWindowHandle
  foreach ($try in 1..3) { if ([W32]::ForceForeground($h)) { return }; Start-Sleep -Milliseconds 200 }
  throw "couldn't bring the LINE window to the front"
}
function CloseWin($win) { [W32]::PostMessage([IntPtr]$win.Current.NativeWindowHandle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null } # WM_CLOSE

# ---------- start
# PowerShell 5.1's ConvertFrom-Json emits a JSON array as ONE object; enumerate it into separate strings.
$chats = @((ConvertFrom-Json $env:LINE_CHATS_JSON) | ForEach-Object { [string]$_ })
if (-not $chats.Count) { Emit @{ error = "No chats configured (LINE_CHATS in .env)" }; exit 1 }
$incoming = Join-Path $OutDir ".incoming"
New-Item -ItemType Directory -Force $incoming | Out-Null
$results = @()

try {
  Say "Don't touch the mouse or keyboard until this finishes (about $(8 * $chats.Count)s)."
  # Warn before taking over the mouse, so the user can let go of it, or cancel. The cancel check lives here in the
  # script (not a kill from outside), so a cancel can never interrupt it halfway through operating LINE.
  foreach ($n in 3..1) {
    Say "Taking control of the mouse in $n…"
    foreach ($tick in 1..10) {
      if ($CancelFile -and (Test-Path -LiteralPath $CancelFile)) {
        Say "Cancelled. LINE was not touched."
        Emit @{ result = @{ chats = @(); cancelled = $true } }
        exit 0
      }
      Start-Sleep -Milliseconds 100
    }
  }
  Say "Taking control now." # after this line the server no longer accepts a cancel
  if (-not (Get-Process -Name LINE -ErrorAction SilentlyContinue)) {
    $exe = if ($env:LINE_EXE) { $env:LINE_EXE } else { Join-Path $env:LOCALAPPDATA "LINE\bin\LineLauncher.exe" }
    Say "Starting LINE ($exe)…"
    Start-Process $exe
  }
  $main = Wait "the LINE main window" { LineWindows | Where-Object { $_.Current.ClassName -eq "AllInOneWindow" } | Select-Object -First 1 } 30000
  Front $main; Start-Sleep -Milliseconds 400
  $search = Wait "the LINE search box (is LINE logged in and unlocked?)" { $main.FindFirst($Scope::Descendants, (ByType ([System.Windows.Automation.ControlType]::Edit))) } 15000

  # Remember which chat-list tab is selected (the one whose checkbox has the 2px underline) to restore it at the end.
  $tabs = @($main.FindAll($Scope::Descendants, (ByClass "TabButton")) | Sort-Object { $_.Current.BoundingRectangle.X })
  $tabBox = { param($tab) $tab.FindFirst($Scope::Children, (ByClass "LcCheckBox")) }
  $selectedTab = $tabs | Where-Object {
    $box = & $tabBox $_
    $box -and ($box.FindAll($Scope::Children, $True_) | Where-Object { $_.Current.BoundingRectangle.Height -le 3 -and $_.Current.BoundingRectangle.Width -gt 5 })
  } | Select-Object -First 1
  $selectedTabIndex = [Array]::IndexOf([object[]]$tabs, $selectedTab)
  if ($tabs.Count) { Click (& $tabBox $tabs[0]); Start-Sleep -Milliseconds 400 } # "All", so 1:1 chats and groups both show

  # Chat windows the user already had open are left alone; any other chat window was opened by this run.
  $openBefore = @(LineWindows | Where-Object { $_.Current.ClassName -eq "ChatWindow" } | ForEach-Object { $_.Current.NativeWindowHandle })
  function CloseOpenedChats {
    LineWindows | Where-Object { $_.Current.ClassName -eq "ChatWindow" -and -not ($openBefore -contains $_.Current.NativeWindowHandle) } |
      ForEach-Object { CloseWin $_ }
  }

  foreach ($chat in $chats) {
    $c0 = Get-Date
    $chatWin = $null
    try {
      Say "[$chat] searching…"
      Front $main
      SetText $search ""; Start-Sleep -Milliseconds 200; SetText $search $chat
      # Wait until LINE shows SEARCH results, not the plain chat list: results start with a short section header
      # ("Chats N", ~34px); the plain list is all ~71px chat rows. Then take the first chat row after that header.
      try {
        $row = Wait "search results for '$chat'" {
          $rows = @($main.FindAll($Scope::Descendants, (ByType ([System.Windows.Automation.ControlType]::ListItem))) |
            Sort-Object { $_.Current.BoundingRectangle.Y })
          if ($rows.Count -ge 2 -and $rows[0].Current.BoundingRectangle.Height -lt 50 -and $rows[1].Current.BoundingRectangle.Height -ge 50) { $rows[1] }
        }
      } catch { throw "LINE found no chat named '$chat' (check the name in LINE_CHATS)" }
      Start-Sleep -Milliseconds 300 # let the list settle before clicking
      Click $row -Double
      # Check #1: the window that opens is titled with the chat's exact name.
      try {
        $chatWin = Wait "the chat window '$chat' to open" {
          LineWindows | Where-Object { $_.Current.ClassName -eq "ChatWindow" -and $_.Current.Name -eq $chat } | Select-Object -First 1
        }
      } catch {
        $other = LineWindows | Where-Object { $_.Current.ClassName -eq "ChatWindow" -and -not ($openBefore -contains $_.Current.NativeWindowHandle) } | Select-Object -First 1
        if ($other) { throw "the top search result was '$($other.Current.Name)', not '$chat'; skipped (check the exact name in LINE_CHATS)" }
        throw
      }
      Front $chatWin; Start-Sleep -Milliseconds 300

      Say "[$chat] opening the chat menu…"
      $panel = Wait "the chat panel" { $chatWin.FindFirst($Scope::Descendants, (ByClass "ChatMessagePanel")) }
      $header = $panel.FindFirst($Scope::Children, $True_)
      $menuBtn = @($header.FindAll($Scope::Children, (ByClass "LcButton"))) | Sort-Object { $_.Current.BoundingRectangle.X } | Select-Object -Last 1
      if (-not $menuBtn) { throw "chat menu button not found" }
      Click $menuBtn
      $menu = Wait "the chat menu" { LineWindows | Where-Object { $_.Current.ClassName -eq "LcContextMenu" } | Select-Object -First 1 } 3000
      $items = @($menu.FindAll($Scope::Descendants, $True_) |
        Where-Object { $_.Current.ClassName -in "LcContextMenuItem", "LcCheckableContextMenuItem" } |
        Sort-Object { $_.Current.BoundingRectangle.Y })
      $anchor = [Array]::FindIndex([object[]]$items, [Predicate[object]] { param($e) $e.Current.ClassName -eq "LcCheckableContextMenuItem" })
      if ($anchor -lt 0 -or $anchor + 1 -ge $items.Count) { Esc; throw "couldn't locate 'Save chat' in the menu (LINE's menu layout changed?)" }
      Click $items[$anchor + 1]

      Say "[$chat] saving…"
      # The dialog is owned by the chat window, so UIA lists it under it (not at the top level).
      $dialog = Wait "the Save As dialog" {
        $d = $chatWin.FindFirst($Scope::Children, (ByClass "#32770"))
        if (-not $d) { $d = $UIA::RootElement.FindFirst($Scope::Children, (ByClass "#32770")) }
        $d
      }
    } catch {
      if (LineWindows | Where-Object { $_.Current.ClassName -eq "LcContextMenu" }) { Esc } # a menu left open
      CloseOpenedChats # including a wrong chat that check #1 rejected
      $results += @{ chat = $chat; ok = $false; error = "$_" }
      Say "[$chat] ✗ $_"
      continue
    }

    try {
      # Found through LINE's Qt provider the dialog looks empty; re-read it from its native handle to see its controls.
      $dlg = $UIA::FromHandle([IntPtr]$dialog.Current.NativeWindowHandle)
      # In this dialog the file-name box and buttons expose no UIA patterns, but they are plain Win32 controls:
      # read the box's name (= its text), set it with WM_SETTEXT, press buttons with BM_CLICK. Still no keystrokes.
      # (Filter by class too: a file-list item and the address bar reuse IDs 1 and 1001.)
      $nameBox = Wait "the file-name box" { DlgControl $dlg "Edit" "1001" }
      # Check #2: LINE pre-fills "[LINE]<chat>.txt"; anything else means the wrong chat or menu item.
      $suggested = $nameBox.Current.Name
      $expected = "[LINE]$chat.txt"
      if ($suggested -ne $expected) { throw "Save dialog suggested '$suggested', expected '$expected'; cancelled" }

      $target = Join-Path $incoming $expected
      if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force } # no overwrite prompt
      [W32]::SendMessage([IntPtr]$nameBox.Current.NativeWindowHandle, 0x000C, [IntPtr]::Zero, $target) | Out-Null # WM_SETTEXT
      $saveBtn = DlgControl $dlg "Button" "1"
      if (-not $saveBtn) { throw "Save button not found" }
      [W32]::PostMessage([IntPtr]$saveBtn.Current.NativeWindowHandle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null # BM_CLICK

      # Wait for LINE to finish writing: the file exists and its size stops changing.
      $prev = -1
      $size = Wait "LINE to write the file" {
        if (-not (Test-Path -LiteralPath $target)) { return $null }
        $s = (Get-Item -LiteralPath $target).Length
        if ($s -gt 0 -and $s -eq $script:prev) { return $s }
        $script:prev = $s; Start-Sleep -Milliseconds 350; $null
      } 60000
      $first = (Get-Content -LiteralPath $target -TotalCount 3 -Encoding UTF8) -join "`n"
      if ($first -notmatch '(?m)^\d{4}\.\d{2}\.\d{2} [A-Za-z]+day') { throw "the saved file doesn't look like a LINE chat export" }

      $final = Join-Path $OutDir $expected
      Move-Item -LiteralPath $target -Destination $final -Force # only now replace the old export
      $lines = (Get-Content -LiteralPath $final -Encoding UTF8 | Measure-Object -Line).Lines
      $secs = [Math]::Round(((Get-Date) - $c0).TotalSeconds, 1)
      $results += @{ chat = $chat; ok = $true; bytes = $size; lines = $lines }
      Say "[$chat] ✓ saved $([Math]::Round($size / 1KB)) KB, $lines lines ($($secs)s)"
    } catch {
      $d = $chatWin.FindFirst($Scope::Children, (ByClass "#32770"))
      if ($d) { # press Cancel (ID 2) so nothing is saved
        $cancel = DlgControl $UIA::FromHandle([IntPtr]$d.Current.NativeWindowHandle) "Button" "2"
        if ($cancel) { [W32]::PostMessage([IntPtr]$cancel.Current.NativeWindowHandle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null } else { Front $d; Esc }
      }
      $results += @{ chat = $chat; ok = $false; error = "$_" }
      Say "[$chat] ✗ $_"
    } finally {
      Start-Sleep -Milliseconds 300
      CloseOpenedChats
    }
  }

  # Put LINE back how it was: empty search, the tab the user had selected.
  Front $main
  SetText $search ""
  if ($selectedTabIndex -gt 0) { Start-Sleep -Milliseconds 300; Click (& $tabBox $tabs[$selectedTabIndex]) }

  $ok = @($results | Where-Object { $_.ok }).Count
  Say "Done: $ok/$($results.Count) chats exported in $([Math]::Round(((Get-Date) - $t0).TotalSeconds, 1))s"
  Emit @{ result = @{ chats = $results } }
} catch {
  Emit @{ error = "$_" }
  exit 1
}
