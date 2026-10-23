function Api {
    param(
        [string]$Method,
        [string]$Path,
        [string]$Key,
        [hashtable]$Body
    )

    $params = @{
        Method      = $Method
        Uri         = "http://localhost:3000$Path"
        Headers     = @{ "X-API-Key" = $Key }
    }

    if ($PSBoundParameters.ContainsKey("Body")) {
        $params.ContentType = "application/json"
        $params.Body = $Body | ConvertTo-Json -Compress
    }

    Invoke-RestMethod @params
}

