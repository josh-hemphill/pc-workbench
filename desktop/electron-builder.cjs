module.exports = {
  appId: 'org.pcworkbench.desktop',
  productName: 'PC Workbench',
  asar: true,
  npmRebuild: false,
  nodeGypRebuild: false,
  files: ['main.cjs', 'protocol.cjs', 'package.json', '!node_modules{,/**/*}'],
  win: { target: [{ target: 'portable', arch: ['x64'] }], signAndEditExecutable: false },
  portable: { artifactName: 'pc-workbench-desktop-win-x64.exe', requestExecutionLevel: 'user' },
};
