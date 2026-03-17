$dests = @("http://127.0.0.1:8000/api/auth/login", "http://localhost:8000/api/auth/login")
$origins = @("http://localhost:3000", "http://127.0.0.1:3000", "http://192.168.1.108:3000")

foreach ($dest in $dests) {
    Write-Host "`nTesting Destination: $dest"
    foreach ($origin in $origins) {
        Write-Host "  From Origin: $origin"
        try {
            $response = Invoke-WebRequest -Uri $dest -Method Options -Headers @{ "Origin" = $origin; "Access-Control-Request-Method" = "POST" } -ErrorAction Stop
            Write-Host "    [OK] CORS Allowed. Status: $($response.StatusCode)"
        } catch {
            Write-Host "    [FAIL] $_"
        }
    }
}
