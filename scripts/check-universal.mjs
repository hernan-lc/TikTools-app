import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../src/universal/',import.meta.url));
const lock=JSON.parse(readFileSync(root+'vendor-lock.json','utf8'));
for(const [file,expected]of Object.entries(lock.sha256))if(createHash('sha256').update(readFileSync(root+file)).digest('hex')!==expected)throw Error('Universal SDK vendor drift: '+file);
console.log('Universal SDK '+lock.version+' hashes verified');
