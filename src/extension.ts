'use strict';
import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import { Store } from './store';
import {
  getInstalledExtensions,
  getSettings,
  getLocale,
  getKeybindings,
  updateStore,
  readdir,
  readConf,
  writeConf,
  sha1sum,
  installExtensions,
  writeback,
  acquireLock
} from './utils';
import * as env from './env';
import * as chokidar from 'chokidar';
const lockfile = require('proper-lockfile');

export function activate(context: vscode.ExtensionContext) {
  // TODO preserve comments and order of settings
  // TODO sync snippets
  // TODO cross platform
  main();
}

export function deactivate() {
  lockfile.check(env.SYNC_LOCK_FILENAME, (err: any, locked: boolean) => {
    if (locked) {
      env.channel.appendLine('release lock');
      lockfile.unlock(env.SYNC_LOCK_FILENAME, (err: any) => {});
    }
  });
}

async function main() {
  env.channel.appendLine('acquiring lock');
  await acquireLock(env.SYNC_LOCK_FILENAME);

  env.channel.appendLine('vscode-simple-sync activating');

  let config = await readConf(env.SYNC_CONFIG_FILENAME);
  if (!config || !config.dir || !config.id) {
    if (
      (await vscode.window.showInformationMessage(
        "Simple sync haven't setup",
        'Setup'
      )) !== 'Setup'
    ) {
      return;
    }
    if (!await setup()) {
      return;
    }
    config = await readConf(env.SYNC_CONFIG_FILENAME);
  }

  if (!config.id) {
    throw new Error(`missing id inside of ${env.SYNC_CONFIG_FILENAME}`);
  }

  await syncProcess(config);
  await watchingChanges(config, async () => {
    await syncProcess(config);
  });
}

async function syncProcess(config: any) {
  env.channel.appendLine('start sync');
  const store = new Store(path.join(config.dir, `${config.id}.db`));

  const configuration = await getConfiguration();
  env.channel.appendLine(
    'configuration: ' + JSON.stringify(configuration, null, 2)
  );

  let wasChanged = updateStore(store, configuration);

  const originStore = store.copy();
  let needWriteback = false;

  await mergeRemoteStores(store, config);

  if (!store.equals(originStore)) {
    wasChanged = true;
    needWriteback = true;
  }

  if (wasChanged) {
    env.channel.appendLine('dump store');
    store.dump();
  }
  if (needWriteback) {
    env.channel.appendLine('writback to user data dir');
    await writeback(store);
  }

  await installExtensions(
    Object.keys(store.doc.extensions).filter(x => x.slice(0, 1) !== '_'),
    Object.keys(configuration.extensions).filter(x => x.slice(0, 1) !== '_')
  );

  env.channel.appendLine('done');
}

async function setup() {
  if (
    (await vscode.window.showInformationMessage(
      'Go select your cloud storage directory',
      'OK'
    )) !== 'OK'
  ) {
    return false;
  }

  let uris = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false
  });
  if (uris === undefined || uris.length < 1) {
    return false;
  }

  let dir = uris[0].fsPath;
  let id = crypto.randomBytes(6).toString('hex');

  let config = { dir, id };
  if ((await readdir(config.dir)).filter(x => x.match(/\.db$/)).length > 0) {
    let answer = await vscode.window.showInformationMessage(
      'Found some remote instances, what do you want to do?',
      'Overwrite from',
      'Overwrite to'
    );

    const store = new Store(path.join(config.dir, `${config.id}.db`));
    switch (answer) {
      case 'Overwrite from':
        await mergeRemoteStores(store, config);
        writeback(store);
        store.dump();
        break;
      case 'Overwrite to':
        await mergeRemoteStores(store, config);
        updateStore(store, await getConfiguration());
        store.dump();
        break;
      default:
        return false;
    }
  }

  await writeConf(env.SYNC_CONFIG_FILENAME, config);
  return true;
}

async function watchingChanges(config: any, syncProcess: () => Promise<any>) {
  env.channel.appendLine('watching changes');
  const paths = [config.dir, env.USER_DATA_DIR, env.EXTENSIONS_DIR];
  env.channel.appendLine(`watches ${JSON.stringify(paths)}`);

  while (true) {
    let watcher = chokidar.watch(paths, { ignored: /(^|[\/\\])\../ });
    let path = await new Promise((resolve, reject) => {
      watcher.on('change', resolve);
      watcher.on('error', reject);
    });
    watcher.close();
    env.channel.appendLine(`${new Date().toString()}: change happened`);
    env.channel.appendLine(`${path} changed`);

    await new Promise(resolve => {
      env.channel.appendLine('wait for awhile');
      setTimeout(resolve, 5000);
    });

    await syncProcess();
  }
}

async function mergeRemoteStores(store: Store, config: any) {
  const files = await readdir(config.dir);
  const otherStoreFiles = files.filter(
    x => x.match(/\.db$/) && x !== `${config.id}.db`
  );

  let state = await readConf(env.SYNC_STATE_FILENAME);
  if (!state) {
    state = {};
  }

  let stateChanged = false;
  for (let file of otherStoreFiles) {
    const storeState = state[file];
    const hash = await sha1sum(path.join(config.dir, file));
    if (storeState && hash === storeState.hash) {
      continue;
    }
    stateChanged = true;
    let otherStore = new Store(path.join(config.dir, file));
    env.channel.appendLine(`merge from ${file}`);
    store.merge(otherStore);
    state[file] = { hash };
  }
  if (stateChanged) {
    env.channel.appendLine('dump state');
    writeConf(env.SYNC_STATE_FILENAME, state);
  }
}

async function getConfiguration() {
  const extensions = await getInstalledExtensions();
  const settings = await getSettings();
  const locale = await getLocale();
  const keybindings = await getKeybindings();
  return { extensions, settings, locale, keybindings };
}
