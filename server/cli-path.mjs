import {accessSync,constants,statSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function cliPath(name,override,searchPath=process.env.PATH||''){
  const candidates=override?[override]:[...searchPath.split(path.delimiter).filter(Boolean),path.join(os.homedir(),'.local/bin'),'/opt/homebrew/bin','/usr/local/bin'].map(dir=>path.join(dir,name));
  return candidates.map(file=>path.resolve(file)).find(file=>{try{accessSync(file,constants.X_OK);return statSync(file).isFile();}catch{return false;}});
}
