@echo off
setlocal
rem Reuse an x64 developer prompt, or find an installation with the C++ tools.
if /i "%VSCMD_ARG_TGT_ARCH%"=="x64" (
  where cl.exe >nul 2>nul
  if not errorlevel 1 goto build
)
set "COMPAT_VS=%VSINSTALLDIR%"
if defined COMPAT_VS goto setup
set "COMPAT_VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%COMPAT_VSWHERE%" (
  echo Visual Studio C++ tools were not found. Run from an x64 developer prompt or set VSINSTALLDIR. 1>&2
  exit /b 1
)
for /f "usebackq delims=" %%i in (`"%COMPAT_VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "COMPAT_VS=%%i"
if not defined COMPAT_VS (
  echo Install the Visual Studio Desktop development with C++ workload. 1>&2
  exit /b 1
)
:setup
call "%COMPAT_VS%\Common7\Tools\VsDevCmd.bat" -arch=x64 -host_arch=x64 >nul
if errorlevel 1 exit /b %errorlevel%
:build
node "%~dp0build-addon.mjs" %*
exit /b %errorlevel%
