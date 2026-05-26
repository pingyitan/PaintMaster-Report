param(
    [Parameter(Mandatory = $true)]
    [string]$AppUrl,

    [Parameter(Mandatory = $true)]
    [string]$UploadKey,

    [string]$ReportFolder = "C:\Users\admin\Documents\report\staff_view"
)

$ErrorActionPreference = "Stop"

$locations = @("MB", "SA", "BA", "BR")
$baseUrl = $AppUrl.TrimEnd("/")

foreach ($location in $locations) {
    $filePath = Join-Path $ReportFolder "$location.pdf"

    if (-not (Test-Path $filePath)) {
        throw "Missing report file: $filePath"
    }

    $uploadUrl = "$baseUrl/upload/$location"
    Write-Host "Uploading $filePath to $uploadUrl"

    Invoke-RestMethod `
        -Method Put `
        -Uri $uploadUrl `
        -Headers @{ "x-upload-key" = $UploadKey } `
        -ContentType "application/pdf" `
        -InFile $filePath
}

Write-Host "All reports uploaded successfully."
