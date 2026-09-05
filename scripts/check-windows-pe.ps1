param(
  [Parameter(Mandatory = $true)]
  [string] $Path
)

$resolved = (Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path
$bytes = [System.IO.File]::ReadAllBytes($resolved)
if ($bytes.Length -lt 0x40) {
  throw "PE validation failed: $resolved is too small"
}

$peOffset = [System.BitConverter]::ToInt32($bytes, 0x3c)
if ($peOffset -lt 0 -or $peOffset + 24 -gt $bytes.Length) {
  throw "PE validation failed: invalid PE header offset"
}
$hasPeSignature =
  $bytes[$peOffset] -eq 0x50 -and
  $bytes[$peOffset + 1] -eq 0x45 -and
  $bytes[$peOffset + 2] -eq 0x00 -and
  $bytes[$peOffset + 3] -eq 0x00
if (-not $hasPeSignature) {
  throw "PE validation failed: $resolved has no PE signature"
}

$optionalHeaderOffset = $peOffset + 4 + 20
if ($optionalHeaderOffset + 70 -gt $bytes.Length) {
  throw "PE validation failed: optional header is truncated"
}
$magic = [System.BitConverter]::ToUInt16($bytes, $optionalHeaderOffset)
if ($magic -ne 0x10b -and $magic -ne 0x20b) {
  throw "PE validation failed: unsupported optional header magic 0x$('{0:X}' -f $magic)"
}

# IMAGE_OPTIONAL_HEADER.Subsystem is at offset 68 for both PE32 and PE32+.
$subsystem = [System.BitConverter]::ToUInt16($bytes, $optionalHeaderOffset + 68)
if ($subsystem -ne 2) {
  throw "Expected Windows GUI subsystem (2), found $subsystem in $resolved"
}

Write-Host "Windows GUI subsystem verified: $resolved"
