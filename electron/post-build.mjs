// 在 dist-electron/ 里写一个 {"type":"commonjs"} 的 package.json,
// 让 Node 把 dist-electron/main.js 当 CommonJS 跑 (覆盖项目根 package.json 的 "type":"module").
// 不然 Electron 启动报 "ERR_REQUIRE_ESM" 或 "Cannot use import statement outside a module".
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const dir = 'dist-electron'
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'commonjs' }, null, 2))
console.log(`[electron] wrote ${dir}/package.json (type: commonjs)`)
