import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
const JSON5 = require('json5');
const jsondiffpatch = require('jsondiffpatch');
import * as env from './env';
import { Store } from './store';
import { isObject, isArray } from 'util';
const lockfile = require('proper-lockfile');
const stringify = require('json-stable-stringify');

export async function getInstalledExtensions() {
  let { stdout } = await exec('code --list-extensions');
  const extensionsList = stdout
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  let extensions: any = {};
  for (let x of extensionsList) {
    extensions[x] = {};
  }
  delete extensions['living42.vscode-simple-sync'];
  return extensions;
}

export async function readConf(filename: string) {
  if (!await fileExists(filename)) {
    return;
  }
  const buffer = <Buffer>await new Promise((resolve, reject) => {
    fs.readFile(filename, (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
  try {
    return JSON5.parse(buffer.toString());
  } catch (e) {
    return {}
  }
}

export async function writeConf(filename: string, config: any) {
  const buffer = stringify(config, { space: '  ' });
  await new Promise((resolve, reject) => {
    fs.writeFile(filename, buffer, err => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

export async function getSettings() {
  const filename = path.join(env.USER_DATA_DIR, 'settings.json');
  return await readConf(filename);
}

export async function getLocale() {
  const filename = path.join(env.USER_DATA_DIR, 'locale.json');
  return await readConf(filename);
}

export async function getKeybindings() {
  const filename = path.join(env.USER_DATA_DIR, 'keybindings.json');
  return await readConf(filename);
}

export async function writeback(store: Store) {
  let propertyFilter = (name: string) => !name.startsWith('_');

  let strip = (obj: any): any => {
    if (isArray(obj)) {
      return obj.map(strip);
    }
    if (isObject(obj)) {
      let copy: any = {};
      Object.keys(obj)
        .filter(propertyFilter)
        .forEach(key => {
          copy[key] = strip(obj[key]);
        });
      return copy;
    }
    return obj;
  };

  let doc: Configuration = store.doc;
  for (let { filename, data } of [
    { filename: 'settings.json', data: doc.settings },
    { filename: 'locale.json', data: doc.locale },
    { filename: 'keybindings.json', data: doc.keybindings }
  ]) {
    let stripedData = strip(data);
    await writeConf(path.join(env.USER_DATA_DIR, filename), stripedData);
  }
}

export async function fileExists(filename: string | Buffer): Promise<boolean> {
  return <boolean>await new Promise((resolve, reject) => {
    fs.access(filename, err => {
      if (err) {
        if (err.code === 'ENOENT') {
          resolve(false);
        } else {
          reject(err);
        }
      } else {
        resolve(true);
      }
    });
  });
}

interface Configuration {
  extensions: any;
  settings: any;
  locale: any;
  keybindings: any;
}

export const differ = jsondiffpatch.create({
  propertyFilter(name: string, context: any) {
    return name.slice(0, 1) !== '_';
  }
});

export function updateStore(store: Store, update: Configuration): boolean {
  const delta = differ.diff(store.doc, update);
  if (delta !== undefined) {
    env.channel.appendLine('settings was changed');
    store.change((doc: any) => {
      differ.patch(doc, delta);
    });
    return true;
  }
  return false;
}

export async function readdir(path: string) {
  return <string[]>await new Promise((resolve, reject) => {
    fs.readdir(path, (err, files) => {
      if (err) {
        reject(err);
      } else {
        resolve(files);
      }
    });
  });
}

export async function sha1sum(filename: string): Promise<string> {
  const hasher = crypto.createHash('sha1');
  const buffer = <Buffer>await new Promise((resolve, reject) => {
    fs.readFile(filename, (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
  hasher.update(buffer);
  return hasher.digest('hex');
}

export async function installExtensions(
  desired: string[],
  installed: string[]
) {
  const desiredSet = new Set(desired);
  const installedSet = new Set(installed);

  for (let x of desired.filter(x => !installedSet.has(x))) {
    env.channel.appendLine(`installing ${x}`);
    await installExtension(x);
  }
  for (let x of installed.filter(x => !desiredSet.has(x))) {
    env.channel.appendLine(`removing ${x}`);
    await uninstallExtension(x);
  }
}

async function installExtension(extension: string) {
  await exec(`code --install-extension ${extension}`);
}

async function uninstallExtension(extension: string) {
  await exec(`code --uninstall-extension ${extension}`);
}

async function exec(command: string) {
  return <{ stdout: string; stderr: string }>await new Promise(
    (resolve, reject) => {
      child_process.exec(command, (err, stdout, stderr) => {
        if (err) {
          reject(stderr);
        } else {
          resolve({ stdout, stderr });
        }
      });
    }
  );
}

export async function acquireLock(file: string) {
  if (!await fileExists(file)) {
    await new Promise((resolve, reject) => {
      fs.writeFile(file, '', err => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
  const acquireLock = async (file: string) => {
    return new Promise((resolve, reject) => {
      lockfile.lock(file, (err: Error) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  };

  await new Promise(async (resolve, reject) => {
    while (true) {
      try {
        await acquireLock(env.SYNC_LOCK_FILENAME);
        resolve();
        break;
      } catch (err) {
        if (err.code === 'ELOCKED') {
          await new Promise(resolve => {
            setTimeout(resolve, 60000);
          });
          continue;
        } else {
          reject(err);
          break;
        }
      }
    }
  });
}
