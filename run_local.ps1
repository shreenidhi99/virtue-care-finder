# Local dev launcher. IDs below are not secrets; auth comes from your Databricks CLI profile.
$cli = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\Databricks.DatabricksCLI_Microsoft.Winget.Source_8wekyb3d8bbwe"
if (Test-Path $cli) { $env:Path = "$cli;$env:Path" }   # SDK calls `databricks auth token`
$env:DATABRICKS_CONFIG_PROFILE = "care-finder"
$env:DATABRICKS_WAREHOUSE_ID   = "0d88dd62ca1e1fec"
$env:GENIE_SPACE_ID            = "01f1e5d2ef9711989854a6d1fb63067c"
$env:VF_SCHEMA                 = "workspace.virtue_finder"
& "$PSScriptRoot\.venv\Scripts\python.exe" -m streamlit run "$PSScriptRoot\app.py" @args
