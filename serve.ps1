param(
    [int]$Port = 4173,
    [switch]$Lan
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$address = [System.Net.IPAddress]::Loopback
if ($Lan) { $address = [System.Net.IPAddress]::Any }
$listener = New-Object System.Net.Sockets.TcpListener($address, $Port)
$types = @{
    '.html' = 'text/html'; '.css' = 'text/css'; '.js' = 'text/javascript'
    '.svg' = 'image/svg+xml'; '.webmanifest' = 'application/manifest+json'
}
$allowed = @('index.html', 'style.css', 'app.js', 'engine.js', 'sound.js', 'progress.js', 'sw.js', 'icon.svg', 'manifest.webmanifest', 'tests.html', 'tests.js')
try {
    $listener.Start()
    Write-Host "Tiny Tide is ready at http://localhost:$Port"
    Write-Host 'Press Ctrl+C to stop. Static development server only; use an HTTPS host for publishing.'
    while ($true) {
        $client = $listener.AcceptTcpClient()
        $client.ReceiveTimeout = 2000
        $client.SendTimeout = 2000
        try {
            $stream = $client.GetStream()
            $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
            $request = $reader.ReadLine()
            if (-not $request) { continue }
            $parts = $request.Split(' ')
            if ($parts.Length -lt 2) { continue }
            $name = ($parts[1] -split '\?', 2)[0].TrimStart('/')
            if ($name -eq '') { $name = 'index.html' }
            $status = '200 OK'
            $contentType = 'text/plain'
            if ($parts[0] -notin @('GET', 'HEAD') -or $name -notin $allowed) {
                $status = '404 Not Found'
                $body = [System.Text.Encoding]::UTF8.GetBytes('Not found')
            } else {
                $body = [System.IO.File]::ReadAllBytes((Join-Path $root $name))
                $contentType = $types[[System.IO.Path]::GetExtension($name)]
            }
            $headers = "HTTP/1.1 $status`r`nContent-Type: $contentType; charset=utf-8`r`nContent-Length: $($body.Length)`r`nCache-Control: no-cache`r`nConnection: close`r`n`r`n"
            $bytes = [System.Text.Encoding]::ASCII.GetBytes($headers)
            $stream.Write($bytes, 0, $bytes.Length)
            if ($parts[0] -ne 'HEAD') { $stream.Write($body, 0, $body.Length) }
            $stream.Flush()
        } catch [System.IO.IOException] {
            Write-Warning "Client connection ended or timed out: $($_.Exception.Message)"
        } catch {
            Write-Error -ErrorAction Continue "Unable to serve request: $($_.Exception.Message)"
        } finally {
            if ($reader) { $reader.Dispose(); $reader = $null }
            $client.Close()
        }
    }
} finally {
    $listener.Stop()
}
