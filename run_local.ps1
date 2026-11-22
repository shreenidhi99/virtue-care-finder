# Local dev launcher. None of these values are secrets; auth comes from your Databricks CLI login.
# Defaults point at the team workspace. To use something else, set the variable in your shell first,
# e.g.  $env:DATABRICKS_CONFIG_PROFILE = "my-profile"; .\run_local.ps1
# See README.md -> "Workspace settings" for where to find each value.
$cli = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\Databricks.DatabricksCLI_Microsoft.Winget.Source_8wekyb3d8bbwe"
if (Test-Path $cli) { $env:Path = "$cli;$env:Path" }   # SDK calls `databricks auth token`

function Set-Default($name, $value) {
    if (-not [Environment]::GetEnvironmentVariable($name)) { Set-Item -Path "env:$name" -Value $value }
}
Set-Default "DATABRICKS_CONFIG_PROFILE" "care-finder"                       # CLI profile holding the workspace URL + login
Set-Default "DATABRICKS_WAREHOUSE_ID"   "0d88dd62ca1e1fec"                  # SQL warehouse that runs the queries
Set-Default "GENIE_SPACE_ID"            "01f1e5d2ef9711989854a6d1fb63067c"  # Genie space (the agent)
Set-Default "VF_SCHEMA"                 "workspace.virtue_finder"           # Unity Catalog catalog.schema

Write-Host "Profile: $env:DATABRICKS_CONFIG_PROFILE | Warehouse: $env:DATABRICKS_WAREHOUSE_ID | Genie: $env:GENIE_SPACE_ID | Schema: $env:VF_SCHEMA"
& "$PSScriptRoot\.venv\Scripts\python.exe" -m streamlit run "$PSScriptRoot\app.py" @args
