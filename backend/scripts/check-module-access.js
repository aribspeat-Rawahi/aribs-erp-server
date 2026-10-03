// CI check (run after `npm run build`): every API route must say who may
// use it - @Public(), @AnySignedInUser() or @ModuleAccess('<module>') on the
// method or its controller. Otherwise a new page's API would be open to
// every signed-in user, bypassing the per-module permissions.
require('reflect-metadata');
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');
const KEYS = ['isPublic', 'anySignedInUser', 'moduleAccess'];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return e.name.endsWith('.controller.js') ? [full] : [];
  });
}

const missing = [];
let routes = 0;
for (const file of walk(DIST)) {
  for (const exported of Object.values(require(file))) {
    if (typeof exported !== 'function' || Reflect.getMetadata('path', exported) === undefined) continue;
    const classTagged = KEYS.some((k) => Reflect.getMetadata(k, exported) !== undefined);
    for (const name of Object.getOwnPropertyNames(exported.prototype)) {
      const handler = exported.prototype[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      if (Reflect.getMetadata('method', handler) === undefined) continue; // not a route
      routes++;
      const tagged = classTagged || KEYS.some((k) => Reflect.getMetadata(k, handler) !== undefined);
      if (!tagged) missing.push(`${exported.name}.${name} (${path.relative(DIST, file)})`);
    }
  }
}

if (routes === 0) {
  console.error('No routes found - run `npm run build` first.');
  process.exit(1);
}
if (missing.length) {
  console.error(`These API routes have no permission tag (@ModuleAccess / @Public / @AnySignedInUser):\n  ${missing.join('\n  ')}`);
  process.exit(1);
}
console.log(`All ${routes} API routes have a permission tag.`);
