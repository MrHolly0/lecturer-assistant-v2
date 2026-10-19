#ifndef PackageRoot
  #error PackageRoot is required
#endif
#ifndef AppVersion
  #error AppVersion is required
#endif
#ifndef TargetRuntime
  #error TargetRuntime is required
#endif
#ifndef SeedFile
  #error SeedFile is required
#endif
#if TargetRuntime == "win-arm64"
  #define AllowedArchitecture "arm64"
#else
  #define AllowedArchitecture "x64compatible and not arm64"
#endif

[Setup]
AppId={{D5A13C3A-10C8-4B0F-92AA-E9762B161DAD}
AppName=Lecturer Assistant — проектор
AppVersion={#AppVersion}
AppPublisher=Lecturer Assistant
AppComments=Необязательный помощник проектора; основной кабинет остаётся на сайте.
DefaultDirName={localappdata}\Programs\LecturerProjector
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed={#AllowedArchitecture}
ArchitecturesInstallIn64BitMode={#AllowedArchitecture}
MinVersion=10.0.19045
AppMutex=Local\LecturerAssistantProjector
SetupMutex=Local\LecturerAssistantProjectorSetup
CloseApplications=no
RestartApplications=no
UninstallFilesDir={app}\uninstall
UninstallDisplayIcon={app}\launcher\Projector.Launcher.exe
OutputDir={#PackageRoot}
OutputBaseFilename=lecturer-projector-{#TargetRuntime}-{#AppVersion}-setup-unsigned
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes
InfoBeforeFile={#PackageRoot}\UNSIGNED.txt
UsePreviousTasks=no
VersionInfoDescription=Lecturer Assistant projector setup (unsigned development build)

[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "autostart"; Description: "Запускать помощник после входа в Windows"; GroupDescription: "Дополнительно:"; Flags: unchecked

[Files]
; This temporary copy validates the installation before installed files are touched.
Source: "{#PackageRoot}\launcher\*"; DestDir: "{tmp}\bootstrap-launcher"; Flags: dontcopy recursesubdirs createallsubdirs
Source: "{#PackageRoot}\bootstrap.json"; DestDir: "{tmp}"; Flags: dontcopy
Source: "{#SeedFile}"; DestDir: "{tmp}"; DestName: "seed.zip"; Flags: dontcopy
Source: "{#PackageRoot}\launcher\*"; DestDir: "{app}\launcher"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#PackageRoot}\bootstrap.json"; DestDir: "{app}\installer"; Flags: ignoreversion
Source: "{#PackageRoot}\UNSIGNED.txt"; DestDir: "{app}\installer"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\Lecturer Assistant\Помощник проектора"; Filename: "{app}\launcher\Projector.Launcher.exe"; Parameters: """{app}"""; WorkingDir: "{app}"
Name: "{autoprograms}\Lecturer Assistant\Удалить помощник проектора"; Filename: "{uninstallexe}"

[Registry]
; The value is written only after successful bootstrap and explicit checkbox selection.
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: none; ValueName: "LecturerAssistantProjector"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\lecturer-projector"; ValueType: string; ValueData: "URL:Lecturer Assistant projector pairing"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\lecturer-projector"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\lecturer-projector\shell\open\command"; ValueType: string; ValueData: """{app}\launcher\Projector.Launcher.exe"" ""{app}"" ""%1"""

[Run]
Filename: "{app}\launcher\Projector.Launcher.exe"; Parameters: """{app}"""; Description: "Запустить помощник проектора"; Flags: postinstall nowait skipifsilent unchecked

[UninstallDelete]
; Files created by signed updates are absent from Inno's original file log.
Type: filesandordirs; Name: "{app}\versions"
Type: filesandordirs; Name: "{app}\staging"
Type: filesandordirs; Name: "{app}\health"
Type: files; Name: "{app}\current.json"
Type: files; Name: "{app}\accepted-release.json"
Type: files; Name: "{app}\staged-update.json"
Type: files; Name: "{app}\quarantine-*.json"
Type: files; Name: "{app}\*.lock"
Type: dirifempty; Name: "{app}"

[Code]
const
  StartupKey = 'Software\Microsoft\Windows\CurrentVersion\Run';
  StartupName = 'LecturerAssistantProjector';
var
  BootstrapExtracted: Boolean;

procedure ExtractBootstrap;
begin
  if BootstrapExtracted then exit;
  ExtractTemporaryFiles('{tmp}\bootstrap-launcher\*');
  ExtractTemporaryFile('bootstrap.json');
  ExtractTemporaryFile('seed.zip');
  BootstrapExtracted := True;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ExitCode: Integer;
begin
  Result := '';
  ExtractBootstrap;
  if not Exec(ExpandConstant('{tmp}\bootstrap-launcher\Projector.Launcher.exe'),
    'bootstrap-check "' + ExpandConstant('{app}') + '" "' + ExpandConstant('{tmp}\bootstrap.json') + '"',
    ExpandConstant('{tmp}'), SW_HIDE, ewWaitUntilTerminated, ExitCode) then
    Result := 'Не удалось проверить установку. Попробуйте запустить установщик ещё раз.'
  else if ExitCode <> 0 then
    Result := 'Установка пока недоступна. Закройте помощник через значок в трее. Если сохранены настройки экранов, сначала верните их из меню помощника. Незавершённое обновление или более новая установленная версия требуют проверки; файлы не удалены.';
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ExitCode: Integer;
  StartupCommand: String;
begin
  if CurStep = ssPostInstall then begin
    if not Exec(ExpandConstant('{app}\launcher\Projector.Launcher.exe'),
      'bootstrap "' + ExpandConstant('{app}') + '" "' + ExpandConstant('{tmp}\seed.zip') + '" "' + ExpandConstant('{tmp}\bootstrap.json') + '"',
      ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ExitCode) then
      RaiseException('Не удалось завершить установку. Существующая версия и журнал восстановления сохранены. Повторите установку.')
    else if ExitCode <> 0 then
      RaiseException('Не удалось безопасно активировать версию. Автозапуск не включён. Закройте помощник, проверьте восстановление экранов и повторите установку.');
    if WizardIsTaskSelected('autostart') then begin
      StartupCommand := '"' + ExpandConstant('{app}\launcher\Projector.Launcher.exe') + '" "' + ExpandConstant('{app}') + '"';
      if not RegWriteStringValue(HKCU, StartupKey, StartupName, StartupCommand) then
        RaiseException('Помощник установлен, но Windows не разрешила включить автозапуск. Его можно включить позже в меню помощника.');
    end;
  end;
end;

function InitializeUninstall: Boolean;
var
  ExitCode: Integer;
begin
  Result := False;
  CreateMutex('Local\LecturerAssistantProjectorMaintenance');
  if not Exec(ExpandConstant('{app}\launcher\Projector.Launcher.exe'),
    'uninstall-check "' + ExpandConstant('{app}') + '"', ExpandConstant('{app}'),
    SW_HIDE, ewWaitUntilTerminated, ExitCode) then begin
    if not UninstallSilent then MsgBox('Не удалось проверить удаление. Восстановите установку тем же или более новым установщиком и повторите удаление.', mbError, MB_OK);
    exit;
  end;
  if ExitCode <> 0 then begin
    if not UninstallSilent then MsgBox('Сначала остановите показ, верните сохранённые настройки экранов и выйдите из помощника через значок в трее. Незавершённое обновление нужно восстановить перед удалением.', mbError, MB_OK);
    exit;
  end;
  Result := True;
end;
