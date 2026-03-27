const WASM_UPLOAD_MAX_INPUT_BYTES = 16 * 1024 * 1024
const WASM_DEFAULT_TIMEOUT_MS = 4_500

let workerRef = null
let nextJobId = 1
let queueTail = Promise.resolve()
const pendingJobs = new Map()
let workerWarmedUp = false

function supportsWasmWorker() {
  return typeof Worker !== 'undefined'
    && typeof Blob !== 'undefined'
    && typeof URL !== 'undefined'
}

function resetWorker(reason = 'WORKER_RESET') {
  if (workerRef) {
    try {
      workerRef.terminate()
    } catch {
      // noop
    }
    workerRef = null
  }
  workerWarmedUp = false

  const error = new Error(reason)
  for (const pending of pendingJobs.values()) {
    if (pending?.timeoutId) clearTimeout(pending.timeoutId)
    pending?.reject?.(error)
  }
  pendingJobs.clear()
}

function handleWorkerMessage(event) {
  const payload = event?.data || {}
  const jobId = Number(payload?.jobId) || 0

  if (payload?.type === 'result' || payload?.type === 'error') {
    workerWarmedUp = true
  }
  if (!jobId) return

  const pending = pendingJobs.get(jobId)
  if (!pending) return
  pendingJobs.delete(jobId)
  if (pending.timeoutId) clearTimeout(pending.timeoutId)

  if (payload?.type === 'result' && payload?.buffer instanceof ArrayBuffer) {
    pending.resolve(new Blob([payload.buffer], { type: 'image/jpeg' }))
    return
  }

  const message = String(payload?.error || payload?.message || 'WASM_THUMBNAIL_FAILED')
  pending.reject(new Error(message))
}

function ensureWorker() {
  if (workerRef) return workerRef
  workerRef = new Worker(new URL('../workers/ffmpegThumb.worker.js', import.meta.url))
  workerRef.onmessage = handleWorkerMessage
  workerRef.onerror = (event) => {
    const message = String(event?.message || 'WASM_WORKER_ERROR')
    resetWorker(message)
  }
  return workerRef
}

async function runWasmJob(inputBlob, options = {}) {
  if (!(inputBlob instanceof Blob) || inputBlob.size <= 0) return null
  if (!supportsWasmWorker()) return null

  const worker = ensureWorker()
  const requestedTimeoutMs = Number(options?.timeoutMs) > 0
    ? Number(options.timeoutMs)
    : WASM_DEFAULT_TIMEOUT_MS
  const timeoutMs = workerWarmedUp
    ? requestedTimeoutMs
    : Math.max(requestedTimeoutMs, 12_000)

  const mimeType = String(options?.mimeType || inputBlob.type || 'application/octet-stream')
  const fileName = String(options?.fileName || 'upload.bin')
  const captureMs = Number(options?.captureMs) > 0 ? Number(options.captureMs) : 1_200
  const maxEdge = Number(options?.maxEdge) > 0 ? Number(options.maxEdge) : 160
  const quality = Number.isFinite(Number(options?.quality))
    ? Number(options.quality)
    : 0.64

  const arrayBuffer = await inputBlob.arrayBuffer()
  if (!arrayBuffer || arrayBuffer.byteLength <= 0) return null

  return await new Promise((resolve, reject) => {
    const jobId = nextJobId++
    const timeoutId = setTimeout(() => {
      if (!pendingJobs.has(jobId)) return
      pendingJobs.delete(jobId)
      reject(new Error('WASM_THUMBNAIL_TIMEOUT'))
      // If ffmpeg got stuck on this input, recreate worker to unblock subsequent jobs.
      resetWorker('WASM_THUMBNAIL_TIMEOUT')
    }, timeoutMs)

    pendingJobs.set(jobId, {
      resolve,
      reject,
      timeoutId,
    })

    try {
      worker.postMessage({
        type: 'extract',
        jobId,
        buffer: arrayBuffer,
        mimeType,
        fileName,
        captureMs,
        maxEdge,
        quality,
      }, [arrayBuffer])
    } catch (err) {
      clearTimeout(timeoutId)
      pendingJobs.delete(jobId)
      reject(err instanceof Error ? err : new Error(String(err || 'WASM_POST_MESSAGE_FAILED')))
    }
  })
}

export async function extractStillFrameFromVideoWithWasm(blob, options = {}) {
  if (!(blob instanceof Blob) || blob.size <= 0) return null
  if (!supportsWasmWorker()) return null

  const boundedBlob = blob.size > WASM_UPLOAD_MAX_INPUT_BYTES
    ? blob.slice(0, WASM_UPLOAD_MAX_INPUT_BYTES, blob.type || 'application/octet-stream')
    : blob

  const execute = async () => {
    try {
      return await runWasmJob(boundedBlob, options)
    } catch {
      return null
    }
  }

  const queued = queueTail.then(execute, execute)
  queueTail = queued.then(() => null, () => null)
  return await queued
}

export function resetVideoThumbWasmWorker(reason = 'RESET_REQUESTED') {
  resetWorker(reason)
}
