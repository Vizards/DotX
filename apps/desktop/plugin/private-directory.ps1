param([Parameter(Mandatory)][string]$Path)
$ErrorActionPreference = 'Stop'
# Node's mode bits do not restrict Windows readers. New credential files inherit
# the data root DACL, initialized once by each entry or setup command.
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$acl = [System.Security.AccessControl.DirectorySecurity]::new()
$acl.SetSecurityDescriptorSddlForm(
  "D:P(A;OICI;FA;;;$sid)(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)",
  [System.Security.AccessControl.AccessControlSections]::Access
)
# Persist only the modified access rules; Set-Acl can also request audit privileges.
[System.IO.Directory]::SetAccessControl($Path, $acl)
