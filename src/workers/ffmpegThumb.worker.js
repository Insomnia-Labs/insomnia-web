const FFMPEG_MAIN_SCRIPT_URLS = [
  'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.11.6/dist/ffmpeg.min.js',
  'https://unpkg.com/@ffmpeg/ffmpeg@0.11.6/dist/ffmpeg.min.js',
]

const FFMPEG_CORE_SCRIPT_URLS = [
  'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js',
  'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js',
]

let ffmpegRef = null
let ffmpegLoadPromise = null

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) return fallback
  return parsed
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function getFileExtension(name = '') {
  const text = String(name || '').trim().toLowerCase()
  if (!text) return ''
  const idx = text.lastIndexOf('.')
  if (idx <= 0 || idx === text.length - 1) return ''
  return text.slice(idx + 1).replace(/[^a-z0-9]/g, '')
}

function toQualityScale(quality = 0.64) {
  const safe = clamp(Number(quality) || 0.64, 0.45, 0.95)
  return clamp(Math.round(12 - safe * 10), 2, 15)
}

function safeUnlink(fs, path) {
  try {
    fs('unlink', path)
  } catch {
    // noop
  }
}

function ensureFfmpegApiLoaded() {
  if (self.FFmpeg && typeof self.FFmpeg.createFFmpeg === 'function') {
    return self.FFmpeg
  }

  let lastError = null
  for (const scriptUrl of FFMPEG_MAIN_SCRIPT_URLS) {
    try {
      importScripts(scriptUrl)
      if (self.FFmpeg && typeof self.FFmpeg.createFFmpeg === 'function') {
        return self.FFmpeg
      }
    } catch (err) {
      lastError = err
    }
  }

  const message = String(lastError?.message || lastError || 'FFMPEG_API_LOAD_FAILED')
  throw new Error(message)
}

async function ensureFfmpegLoaded() {
  if (ffmpegRef) return ffmpegRef
  if (ffmpegLoadPromise) return await ffmpegLoadPromise

  ffmpegLoadPromise = (async () => {
    const api = ensureFfmpegApiLoaded()
    let lastError = null

    for (const corePath of FFMPEG_CORE_SCRIPT_URLS) {
      try {
        const instance = api.createFFmpeg({
          log: false,
          corePath,
        })
        await instance.load()
        ffmpegRef = instance
        return instance
      } catch (err) {
        lastError = err
      }
    }

    const message = String(lastError?.message || lastError || 'FFMPEG_CORE_LOAD_FAILED')
    throw new Error(message)
  })()

  return await ffmpegLoadPromise
}

async function runThumbnailExtraction({ bytes, fileName, captureMs, maxEdge, quality }) {
  const ffmpeg = await ensureFfmpegLoaded()
  if (!bytes || !bytes.length) throw new Error('EMPTY_INPUT_BYTES')

  const ext = getFileExtension(fileName) || 'bin'
  const qscale = toQualityScale(quality)
  const safeCaptureMs = clamp(toInt(captureMs, 1_200), 0, 30_000)
  const captureSec = (safeCaptureMs / 1000).toFixed(3)
  const safeEdge = clamp(toInt(maxEdge, 160), 120, 640)
  const scaleFilter = `scale=min(iw\\,${safeEdge}):-2:flags=lanczos`
  const inputName = `input_${Date.now()}.${ext}`
  const outputName = `thumb_${Date.now()}.jpg`

  try {
    ffmpeg.FS('writeFile', inputName, bytes)

    let extracted = false
    try {
      await ffmpeg.run(
        '-hide_banner',
        '-loglevel', 'error',
        '-ss', captureSec,
        '-i', inputName,
        '-frames:v', '1',
        '-vf', scaleFilter,
        '-q:v', String(qscale),
        '-y',
        outputName
      )
      extracted = true
    } catch {
      // fallback below
    }

    if (!extracted) {
      await ffmpeg.run(
        '-hide_banner',
        '-loglevel', 'error',
        '-i', inputName,
        '-frames:v', '1',
        '-vf', `thumbnail=24,${scaleFilter}`,
        '-q:v', String(qscale),
        '-y',
        outputName
      )
    }

    const output = ffmpeg.FS('readFile', outputName)
    if (!(output instanceof Uint8Array) || output.length <= 0) {
      throw new Error('EMPTY_OUTPUT_JPEG')
    }
    return output
  } finally {
    safeUnlink(ffmpeg.FS, inputName)
    safeUnlink(ffmpeg.FS, outputName)
  }
}

self.onmessage = async (event) => {
  const payload = event?.data || {}
  if (payload?.type !== 'extract') return

  const jobId = Number(payload?.jobId) || 0
  if (!jobId) return

  try {
    const inputBytes = payload?.buffer instanceof ArrayBuffer
      ? new Uint8Array(payload.buffer)
      : null
    if (!inputBytes || inputBytes.length <= 0) {
      throw new Error('INVALID_INPUT_BUFFER')
    }

    const outputBytes = await runThumbnailExtraction({
      bytes: inputBytes,
      fileName: String(payload?.fileName || 'upload.bin'),
      captureMs: payload?.captureMs,
      maxEdge: payload?.maxEdge,
      quality: payload?.quality,
    })

    const outCopy = outputBytes.slice()
    const outBuffer = outCopy.buffer

    self.postMessage({
      type: 'result',
      jobId,
      buffer: outBuffer,
    }, [outBuffer])
  } catch (err) {
    self.postMessage({
      type: 'error',
      jobId,
      error: String(err?.message || err || 'WASM_THUMBNAIL_FAILED'),
    })
  }
}
