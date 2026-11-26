@echo off
setlocal

if exist "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" (
  call "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul
) else if exist "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat" (
  call "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat" >nul
) else if exist "C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\VC\Auxiliary\Build\vcvars64.bat" (
  call "C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul
)

set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

set "USER_WINSDK=%LOCALAPPDATA%\athenaeum-winsdk\winsysroot\Windows Kits\10"
set "USER_SDK_VER=10.0.26100"
if exist "%USER_WINSDK%\Lib\%USER_SDK_VER%\um\x64\kernel32.lib" (
  set "LIB=%LIB%;%USER_WINSDK%\Lib\%USER_SDK_VER%\ucrt\x64;%USER_WINSDK%\Lib\%USER_SDK_VER%\um\x64"
  set "INCLUDE=%INCLUDE%;%USER_WINSDK%\Include\%USER_SDK_VER%\ucrt;%USER_WINSDK%\Include\%USER_SDK_VER%\um;%USER_WINSDK%\Include\%USER_SDK_VER%\shared"
)

set "USER_RC_DIR=%LOCALAPPDATA%\athenaeum-winsdk\buildtools\bin\10.0.28000.0\x64"
if exist "%USER_RC_DIR%\rc.exe" (
  set "PATH=%USER_RC_DIR%;%PATH%"
  set "RC=%USER_RC_DIR%\rc.exe"
)

%*
exit /b %ERRORLEVEL%
