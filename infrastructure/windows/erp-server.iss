; ERP Server installer (Inno Setup 6).
;
; Wraps the payload produced by build-payload.ps1. Everything that can be
; verified without an installer lives in that script and in install.ps1; this
; file only collects the operator's answers, lays the files down and calls
; install.ps1. Keeping the logic out of Pascal script is deliberate — .ps1 can
; be run, re-run and debugged on a customer's machine during a support call.
;
; Requires Inno Setup 6.3 or newer: "x64compatible" below was introduced there
; (older 6.x spells it "x64").
;
; Build:  iscc erp-server.iss /DPayloadDir=..\..\dist\erp-server /DAppVersion=0.1.0

#ifndef PayloadDir
  #define PayloadDir "..\..\dist\erp-server"
#endif
#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif

#define AppName "ERP Server"
#define AppPublisher "ERP"

[Setup]
AppId={{8F3C2A16-7C9E-4C2B-9E4D-6E0F1B2A3C4D}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\ERP Server
DefaultGroupName=ERP
DisableProgramGroupPage=yes
OutputBaseFilename=ERPServerSetup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; The services, the ACL hardening and the PostgreSQL data directory all need
; elevation; asking once up front beats failing halfway through.
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
; A 32-bit Windows cannot run the bundled x64 PostgreSQL or Node.
ArchitecturesAllowed=x64compatible
; Windows 10 or newer: that is the floor for the bundled PostgreSQL and for
; the self-contained WinSW build.
MinVersion=10.0
UninstallDisplayName={#AppName}

[Languages]
Name: "es"; MessagesFile: "compiler:Languages\Spanish.isl"

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Dirs]
; Created here so they exist with the install directory's (restricted) ACL
; before any service writes to them.
Name: "{app}\logs"
Name: "{app}\backups"
Name: "{app}\config"

[Code]
var
  CompanyPage: TInputQueryWizardPage;
  AdminPage: TInputQueryWizardPage;
  BackupPage: TInputQueryWizardPage;

procedure InitializeWizard;
begin
  CompanyPage := CreateInputQueryPage(wpSelectDir,
    'Datos de la empresa',
    'Con qué empresa arranca el sistema',
    'Se crea una única empresa, vacía. Vas a poder cargar clientes, productos y precios desde Gestión.');
  CompanyPage.Add('Razón social:', False);
  CompanyPage.Add('CUIT:', False);

  AdminPage := CreateInputQueryPage(CompanyPage.ID,
    'Usuario administrador',
    'La primera cuenta del sistema',
    'Con esta cuenta vas a entrar por primera vez y crear el resto de los usuarios.');
  AdminPage.Add('Correo electrónico:', False);
  AdminPage.Add('Contraseña:', True);
  AdminPage.Add('Repetir contraseña:', True);

  BackupPage := CreateInputQueryPage(AdminPage.ID,
    'Copias de seguridad',
    'Cuándo y por cuánto tiempo',
    'Las copias se guardan en la carpeta "backups" del servidor. Se verifica que cada copia se pueda restaurar.');
  BackupPage.Add('Hora diaria (HH:MM):', False);
  BackupPage.Add('Días a conservar:', False);
  BackupPage.Values[0] := '03:00';
  BackupPage.Values[1] := '30';
end;

function IsValidTime(const Value: string): Boolean;
var
  Hour, Minute: Integer;
begin
  Result := False;
  if Length(Value) <> 5 then Exit;
  if Value[3] <> ':' then Exit;
  Hour := StrToIntDef(Copy(Value, 1, 2), -1);
  Minute := StrToIntDef(Copy(Value, 4, 2), -1);
  Result := (Hour >= 0) and (Hour <= 23) and (Minute >= 0) and (Minute <= 59);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;

  if CurPageID = CompanyPage.ID then
  begin
    if Trim(CompanyPage.Values[0]) = '' then
    begin
      MsgBox('Ingresá la razón social de la empresa.', mbError, MB_OK);
      Result := False;
    end
    else if Trim(CompanyPage.Values[1]) = '' then
    begin
      MsgBox('Ingresá el CUIT de la empresa.', mbError, MB_OK);
      Result := False;
    end;
  end

  else if CurPageID = AdminPage.ID then
  begin
    if Pos('@', AdminPage.Values[0]) = 0 then
    begin
      MsgBox('Ingresá un correo electrónico válido.', mbError, MB_OK);
      Result := False;
    end
    else if AdminPage.Values[1] <> AdminPage.Values[2] then
    begin
      MsgBox('Las contraseñas no coinciden.', mbError, MB_OK);
      Result := False;
    end
    else if Length(AdminPage.Values[1]) < 12 then
    begin
      // Mirrors the API's own password policy. Checked here so the operator
      // finds out now, not after the install script fails at the last step.
      MsgBox('La contraseña debe tener al menos 12 caracteres.', mbError, MB_OK);
      Result := False;
    end;
  end

  else if CurPageID = BackupPage.ID then
  begin
    if not IsValidTime(BackupPage.Values[0]) then
    begin
      MsgBox('La hora debe tener el formato HH:MM (por ejemplo 03:00).', mbError, MB_OK);
      Result := False;
    end
    else if StrToIntDef(BackupPage.Values[1], 0) < 1 then
    begin
      MsgBox('Los días a conservar deben ser un número mayor que cero.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

{ Wraps a value as a single-quoted PowerShell literal, doubling any embedded
  apostrophe.

  Without this a company name like "D'Angelo SRL" — or a password containing an
  apostrophe — would terminate the string early and produce a data file that
  Import-PowerShellDataFile either rejects or reads wrongly. The operator would
  see the install fail at the last step with no useful explanation. }
function PsLiteral(Value: string): string;
begin
  StringChangeEx(Value, '''', '''''', True);
  Result := '''' + Value + '''';
end;

{ Arguments are passed via a parameter file rather than the command line:
  the administrator password would otherwise be visible to every process on
  the machine while the installer runs. }
function BuildParameterFile: string;
var
  Path: string;
  Lines: TArrayOfString;
begin
  Path := ExpandConstant('{tmp}\erp-install-args.psd1');
  SetArrayLength(Lines, 8);
  Lines[0] := '@{';
  Lines[1] := '  InstallDir = ' + PsLiteral(ExpandConstant('{app}'));
  Lines[2] := '  CompanyName = ' + PsLiteral(Trim(CompanyPage.Values[0]));
  Lines[3] := '  CompanyTaxId = ' + PsLiteral(Trim(CompanyPage.Values[1]));
  Lines[4] := '  AdminEmail = ' + PsLiteral(Trim(AdminPage.Values[0]));
  Lines[5] := '  AdminPassword = ' + PsLiteral(AdminPage.Values[1]);
  Lines[6] := '  BackupTimes = ' + PsLiteral(BackupPage.Values[0]);
  { Validated as a positive integer by NextButtonClick, so it needs no quoting. }
  Lines[7] := '  BackupRetentionDays = ' + BackupPage.Values[1] + '; }';
  SaveStringsToFile(Path, Lines, False);
  Result := Path;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  ArgsFile: string;
  Command: string;
begin
  if CurStep = ssPostInstall then
  begin
    ArgsFile := BuildParameterFile;

    { Splatting a hashtable read from a file needs -Command, not -File. }
    Command := '-ExecutionPolicy Bypass -NoProfile -Command "& { $p = Import-PowerShellDataFile ''' +
      ArgsFile + '''; & ''' + ExpandConstant('{app}\scripts\install.ps1') + ''' @p }"';

    if not Exec('powershell.exe', Command, '', SW_SHOW, ewWaitUntilTerminated, ResultCode) then
    begin
      MsgBox('No se pudo ejecutar la configuración inicial.', mbCriticalError, MB_OK);
      Abort;
    end;

    DeleteFile(ArgsFile);

    if ResultCode <> 0 then
    begin
      MsgBox('La configuración inicial falló (código ' + IntToStr(ResultCode) + ').' + #13#10 +
        'Revisá el registro en ' + ExpandConstant('{app}\logs') + ' y volvé a ejecutar ' +
        'scripts\install.ps1 como administrador.', mbCriticalError, MB_OK);
      Abort;
    end;
  end;
end;

[UninstallRun]
; Stops and removes the services before the files they run from are deleted.
Filename: "powershell.exe"; \
  Parameters: "-ExecutionPolicy Bypass -NoProfile -File ""{app}\scripts\uninstall.ps1"" -InstallDir ""{app}"""; \
  RunOnceId: "RemoveErpServices"; Flags: waituntilterminated runhidden

[UninstallDelete]
; The data directory and the backups are deliberately NOT deleted: uninstalling
; the application must never be the action that destroys the business's data.
; The uninstaller says so, and leaves both folders behind.
Type: filesandordirs; Name: "{app}\logs"
Type: filesandordirs; Name: "{app}\services"
