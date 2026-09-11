param(
  [Parameter(Mandatory)][string]$Executable,
  [Parameter(Mandatory)][string]$Evidence
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing, System.Windows.Forms
New-Item -ItemType Directory -Path $Evidence | Out-Null
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--force-renderer-accessibility'
$app = Start-Process -FilePath $Executable -PassThru
try {
  $deadline = [DateTime]::UtcNow.AddSeconds(90)
  $names = @()
  do {
    Start-Sleep -Seconds 2
    $app.Refresh()
    if ($app.HasExited) { throw "Canopi exited before its welcome screen rendered" }
    if ($app.MainWindowHandle -eq 0) { continue }
    $window = [System.Windows.Automation.AutomationElement]::FromHandle($app.MainWindowHandle)
    $elements = $window.FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition
    )
    $names = @($elements | ForEach-Object { $_.Current.Name } | Where-Object { $_ })
    if ($names -contains 'New Design' -and $names -contains 'Open Design') { break }
  } while ([DateTime]::UtcNow -lt $deadline)
  $names | ConvertTo-Json | Set-Content (Join-Path $Evidence 'accessibility.json')
  $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $bitmap.Save((Join-Path $Evidence 'startup.png'))
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
  if ($names -notcontains 'New Design' -or $names -notcontains 'Open Design') {
    throw 'Canopi did not expose both welcome actions; inspect the screenshot and accessibility evidence'
  }
} finally {
  $app.Refresh()
  if (-not $app.HasExited) {
    & taskkill /PID $app.Id /T /F
    if ($LASTEXITCODE -ne 0) { throw 'Could not stop the benchmark application process tree' }
  }
  $app.Dispose()
}
