import path from 'node:path';

/** IExpress uses an INI file; keep build paths from injecting INI entries. */
export function createIExpressConfig(sourceDirectory: string, targetFile: string, launcher: string, files: string[]): string {
  for (const value of [sourceDirectory, targetFile]) {
    if (!path.win32.isAbsolute(value) || /[\r\n\0%"]/.test(value)) {
      throw Error('IExpress build paths must be absolute and cannot contain line breaks, quotes, nulls or percent signs.');
    }
  }
  if (!files.length || !files.includes(launcher) || files.some(file => !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(file))) {
    throw Error('IExpress requires plain ASCII payload filenames and an included launcher.');
  }
  return [
    '[Version]', 'Class=IEXPRESS', 'SEDVersion=3',
    '[Options]', 'PackagePurpose=InstallApp', 'ShowInstallProgramWindow=1',
    'HideExtractAnimation=1', 'UseLongFileName=1', 'InsideCompressed=0',
    'CAB_FixedSize=0', 'CAB_ResvCodeSigning=0', 'RebootMode=N',
    'InstallPrompt=%InstallPrompt%', 'DisplayLicense=%DisplayLicense%',
    'FinishMessage=%FinishMessage%', 'TargetName=%TargetName%',
    'FriendlyName=%FriendlyName%', 'AppLaunched=%AppLaunched%',
    'PostInstallCmd=%PostInstallCmd%', 'AdminQuietInstCmd=%AdminQuietInstCmd%',
    'UserQuietInstCmd=%UserQuietInstCmd%', 'SourceFiles=SourceFiles',
    '[Strings]', 'InstallPrompt=', 'DisplayLicense=', 'FinishMessage=',
    `TargetName=${targetFile}`, 'FriendlyName=PC Workbench Deno Prototype',
    `AppLaunched=${launcher}`, 'PostInstallCmd=<None>',
    'AdminQuietInstCmd=', 'UserQuietInstCmd=',
    ...files.map((file, index) => `FILE${index}=${file}`),
    '[SourceFiles]', `SourceFiles0=${sourceDirectory.replace(/[\\/]$/, '')}\\`,
    '[SourceFiles0]', ...files.map((_file, index) => `%FILE${index}%=`), '',
  ].join('\r\n');
}
