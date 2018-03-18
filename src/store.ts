import * as fs from 'fs';
const automerge = require('automerge');

export class Store {
  filename: string;
  _doc: any;

  constructor(filename: string) {
    this.filename = filename;
    this._doc = this._initDoc(filename);
  }
  _initDoc(filename: string) {
    if (fs.existsSync(filename)) {
      const data = fs.readFileSync(filename).toString();
      return automerge.load(data);
    } else {
      return automerge.init();
    }
  }
  get doc() {
    return this._doc;
  }
  change(callback: any) {
    this._doc = automerge.change(this._doc, (doc: any) => {
      callback(doc);
    });
  }
  dump() {
    return fs.writeFileSync(this.filename, automerge.save(this._doc));
  }
  merge(other: Store) {
    this._doc = automerge.merge(this._doc, other._doc);
  }
  copy(): Store {
    const store = new Store(this.filename);
    store._doc = this._doc;
    return store;
  }
  equals(other: Store): boolean {
    return automerge.equals(this._doc, other._doc);
  }
}
