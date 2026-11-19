import { app, BrowserWindow } from 'electron';
import { chromeMajor, userAgent } from '../core/identity.ts';

app.userAgentFallback = userAgent(chromeMajor(process.versions.chrome));

function createWindow(): void {
  const win = new BrowserWindow({ width: 1400, height: 900, titleBarStyle: 'hiddenInset' });
  void win.loadURL('https://www.google.com');
}

void app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());
