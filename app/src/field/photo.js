// Photo capture helper — shrink on-device BEFORE the outbox sees the image.
// Phone cameras emit 3-12 MB files; the outbox persists to localStorage
// (~5 MB quota), so a queued photo must be a few hundred KB at most. Max edge
// 1280 px at JPEG q0.72 lands around 100-250 KB — plenty for Gemma to read
// damage, hazards and people from (the pipeline only ever sees this copy).

const MAX_EDGE = 1280
const JPEG_QUALITY = 0.72

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('no se pudo leer la foto'))
    reader.readAsDataURL(file)
  })
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('formato de imagen no soportado'))
    img.src = src
  })
}

// File → { base64, mime, previewUrl }. base64 is the raw payload for
// POST /api/reports (no data: prefix); previewUrl feeds the <img> thumbnail.
export async function fileToCompressedPhoto(file) {
  const img = await loadImage(await readAsDataURL(file))
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d').drawImage(img, 0, 0, w, h)

  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
  return {
    base64: dataUrl.slice(dataUrl.indexOf(',') + 1),
    mime: 'image/jpeg',
    previewUrl: dataUrl,
  }
}
