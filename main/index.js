const {app, BrowserWindow} = require('electron');

require('electron-debug')({showDevTools: true});

app.on('ready', function () {
  let mainWindow = new BrowserWindow({
    width: 800,
    height: 500
  });
  mainWindow.loadURL('http://localhost:8888/dist/index.html');
});
