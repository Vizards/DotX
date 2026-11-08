param([Parameter(Mandatory)][string]$Path, [switch]$Directory)
$ErrorActionPreference = 'Stop'
# Node's mode bits do not restrict Windows readers. Initialize a protected DACL
# once per process/path, including explicit permissions on an existing private key.
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
if ($Directory) {
  $acl = [System.Security.AccessControl.DirectorySecurity]::new()
  $flags = 'OICI'
} else {
  $acl = [System.Security.AccessControl.FileSecurity]::new()
  $flags = ''
}
$acl.SetSecurityDescriptorSddlForm(
  "D:P(A;$flags;FA;;;$sid)(A;$flags;FA;;;SY)(A;$flags;FA;;;BA)",
  [System.Security.AccessControl.AccessControlSections]::Access
)
# Persist only the modified access rules; Set-Acl can also request audit privileges.
if ($Directory) {
  [System.IO.Directory]::SetAccessControl($Path, $acl)
} else {
  [System.IO.File]::SetAccessControl($Path, $acl)
}
