import * as vscode from 'vscode';
import { platform, homedir } from 'os';
import { join } from 'path';

if (platform() !== 'darwin') {
  throw new Error('Currently, only macOS supported');
}

export const EXTENSIONS_DIR = join(homedir(), '.vscode/extensions');

export const USER_DATA_DIR = join(
  homedir(),
  'Library/Application Support/Code/User'
);

export const SYNC_CONFIG_FILENAME = join(
  USER_DATA_DIR,
  'vscode-simple-sync.json'
);

export const SYNC_STATE_FILENAME = join(
  USER_DATA_DIR,
  'vscode-simple-sync.state'
);

export const SYNC_LOCK_FILENAME = join(
  USER_DATA_DIR,
  'vscode-simple-sync.lock'
);

export const channel = vscode.window.createOutputChannel('Simple Sync');
