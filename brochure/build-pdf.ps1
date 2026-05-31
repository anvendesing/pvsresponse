# Build NovaERP-Features.pdf from brochure.html via Edge headless print
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if (-not (Test-Path $edge)) {
  $edge = "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
}
$htmlPath = "file:///d:/coding/pvsresponse/brochure/brochure.html"
$pdfOut = "d:\coding\pvsresponse\brochure\NovaERP-Features.pdf"
$rootPdf = "d:\coding\pvsresponse\NovaERP-Features.pdf"

& $edge --headless=new --disable-gpu --no-pdf-header-footer `
  --print-to-pdf="$pdfOut" --print-to-pdf-no-header "$htmlPath" 2>&1 | Out-Null

Start-Sleep -Seconds 2
if (-not (Test-Path $pdfOut)) {
  Write-Error "PDF was not created at $pdfOut"
  exit 1
}
Copy-Item $pdfOut $rootPdf -Force
$size = (Get-Item $pdfOut).Length
Write-Host "PDF: $pdfOut ($([math]::Round($size/1KB, 1)) KB)"
Write-Host "Copy: $rootPdf"
