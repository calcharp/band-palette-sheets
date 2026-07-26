import sharp from 'sharp'
import pngToIco from 'png-to-ico'
import fs from 'fs'

const src = 'build/paletter-icon-source.png'

const { data, info } = await sharp(src)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true })

const px = Buffer.from(data)
for (let i = 0; i < px.length; i += 4) {
  const r = px[i]
  const g = px[i + 1]
  const b = px[i + 2]
  if (r < 18 && g < 18 && b < 18) px[i + 3] = 0
}

let img = sharp(px, { raw: { width: info.width, height: info.height, channels: 4 } })
img = sharp(await img.trim({ threshold: 5 }).png().toBuffer())
const meta = await img.metadata()
const size = Math.max(meta.width ?? 1, meta.height ?? 1)
const left = Math.floor((size - (meta.width ?? 0)) / 2)
const top = Math.floor((size - (meta.height ?? 0)) / 2)

const square = await sharp({
  create: {
    width: size,
    height: size,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite([{ input: await img.png().toBuffer(), left, top }])
  .png()
  .toBuffer()

const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const pngs = []
for (const s of icoSizes) {
  const out = `build/icon-${s}.png`
  await sharp(square)
    .resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(out)
  pngs.push(out)
}

await sharp(square).resize(512, 512).png().toFile('build/paletter-icon.png')
await sharp(square).resize(512, 512).png().toFile('public/paletter-icon.png')
await sharp(square).resize(64, 64).png().toFile('public/favicon.png')

const ico = await pngToIco(pngs)
fs.writeFileSync('build/icon.ico', ico)
console.log('Wrote build/paletter-icon.png, build/icon.ico, public/favicon.png')
