/**
 * 自动把剪映草稿 zip 解压写进用户预先选定的剪映草稿目录.
 * 使用浏览器 File System Access API (Chrome/Edge 原生支持; Safari/Firefox fallback 下载 zip).
 *
 * 流程:
 * 1. 用户第一次点 "导出剪映草稿" — 弹出 showDirectoryPicker 让用户选剪映草稿目录
 * 2. handle 存进 IndexedDB, 后续不用再选
 * 3. 每次导出: fetch zip → JSZip 解压 → 把每个文件写进对应子文件夹
 * 4. 用户切到剪映就能看到新草稿
 */
import JSZip from 'jszip'

const DB_NAME = 'monoi-jianying'
const STORE_NAME = 'handles'
const HANDLE_KEY = 'jianying-draft-dir'

export function isFileSystemAPISupported(): boolean {
  return typeof (window as any).showDirectoryPicker === 'function'
}

// ============ IndexedDB 持久化 handle ============

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function dbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(key)
    req.onsuccess = () => resolve(req.result as T | undefined)
    req.onerror = () => reject(req.error)
  })
}

async function dbSet<T>(key: string, value: T): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function dbDel(key: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ============ FileSystem handle 权限 ============

async function ensurePermission(handle: any, mode: 'read' | 'readwrite' = 'readwrite'): Promise<boolean> {
  if (await handle.queryPermission({ mode }) === 'granted') return true
  if (await handle.requestPermission({ mode }) === 'granted') return true
  return false
}

// ============ 公开 API ============

/** 弹文件夹选择对话框, 让用户选剪映草稿目录, 存进 IndexedDB. */
export async function pickAndSaveDraftDir(): Promise<any> {
  if (!isFileSystemAPISupported()) {
    throw new Error('当前浏览器不支持 File System Access API, 请用 Chrome / Edge')
  }
  const handle = await (window as any).showDirectoryPicker({
    id: 'jianying-draft',
    mode: 'readwrite',
    startIn: 'documents',
  })
  await dbSet(HANDLE_KEY, handle)
  return handle
}

/** 读出已保存的 handle (如果有). 没权限会返 null. */
export async function getSavedDraftDir(): Promise<any | null> {
  const handle = await dbGet<any>(HANDLE_KEY)
  if (!handle) return null
  const ok = await ensurePermission(handle, 'readwrite')
  if (!ok) return null
  return handle
}

/** 忘记当前已保存的目录 (用户想换一个时调). */
export async function forgetDraftDir(): Promise<void> {
  await dbDel(HANDLE_KEY)
}

/**
 * 拉 zip → JSZip 解压 → 把所有文件夹/文件写进 dirHandle 下.
 * zip 里第一层通常是 monoi_<时间戳>/, 解压后剪映草稿目录里多了这个文件夹.
 */
export async function downloadAndExtractZipToFolder(
  zipUrl: string,
  dirHandle: any,
  onProgress?: (msg: string) => void,
): Promise<{ rootFolderName: string; fileCount: number }> {
  onProgress?.('下载草稿包...')
  const res = await fetch(zipUrl)
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`)
  const blob = await res.blob()

  onProgress?.('解压中...')
  const zip = await JSZip.loadAsync(blob)

  // 找根目录名 (zip 第一层应该是 monoi_<时间戳>/, 把它创出来)
  let rootFolderName: string | null = null
  for (const path of Object.keys(zip.files)) {
    const seg = path.split('/')[0]
    if (seg) { rootFolderName = seg; break }
  }
  if (!rootFolderName) throw new Error('zip 是空的')

  // 逐个文件写
  const entries = Object.entries(zip.files)
  let count = 0
  for (const [path, entry] of entries) {
    if (entry.dir) continue
    onProgress?.(`写入 (${++count}/${entries.length}) ${path}`)
    const fileBlob = await entry.async('blob')
    await writeFileToDir(dirHandle, path, fileBlob)
  }

  return { rootFolderName, fileCount: count }
}

// 把 zip 内的相对路径 (例 `monoi_xxx/materials/narration.m4a`) 解析成子目录链, 创建必要的子目录, 写入文件
async function writeFileToDir(rootDir: any, relPath: string, content: Blob): Promise<void> {
  const parts = relPath.split('/').filter(Boolean)
  if (parts.length === 0) return
  const fileName = parts.pop()!
  let cur = rootDir
  for (const dirName of parts) {
    cur = await cur.getDirectoryHandle(dirName, { create: true })
  }
  const fileHandle = await cur.getFileHandle(fileName, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(content)
  await writable.close()
}
