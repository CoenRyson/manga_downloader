export type PdfImageSource = { data: Uint8Array; mediaType: string };

type EncodedPdfImage = { data: Uint8Array; width: number; height: number };

async function encodeAsJpeg(source: PdfImageSource) {
  const bitmap = await createImageBitmap(new Blob([source.data], { type: source.mediaType }));
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("Pro PDF není dostupný canvas");
  }
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const jpeg = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Obrázek se nepodařilo převést do PDF")), "image/jpeg", 0.94);
  });
  return { data: new Uint8Array(await jpeg.arrayBuffer()), width: canvas.width, height: canvas.height };
}

function text(value: string) {
  return new TextEncoder().encode(value);
}

function joinBytes(parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

export async function createImagePdf(sources: PdfImageSource[]) {
  if (!sources.length) throw new Error("PDF nemá žádné stránky");
  const images: EncodedPdfImage[] = [];
  for (const source of sources) images.push(await encodeAsJpeg(source));
  const parts: Uint8Array[] = [new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10, 37, 255, 255, 255, 255, 10])];
  const offsets: number[] = [];
  let position = parts[0].length;
  const add = (id: number, body: Uint8Array[]) => {
    offsets[id] = position;
    const start = text(`${id} 0 obj\n`);
    const end = text("\nendobj\n");
    parts.push(start, ...body, end);
    position += start.length + body.reduce((total, part) => total + part.length, 0) + end.length;
  };
  const pageIds = images.map((_, index) => 3 + index * 3);
  add(1, [text("<< /Type /Catalog /Pages 2 0 R >>")]);
  add(2, [text(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`)]);
  images.forEach((image, index) => {
    const pageId = pageIds[index];
    const imageId = pageId + 1;
    const contentId = pageId + 2;
    const content = text(`q\n${image.width} 0 0 ${image.height} 0 0 cm\n/Im0 Do\nQ\n`);
    add(pageId, [text(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${image.width} ${image.height}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`)]);
    add(imageId, [text(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.data.length} >>\nstream\n`), image.data, text("\nendstream")]);
    add(contentId, [text(`<< /Length ${content.length} >>\nstream\n`), content, text("endstream")]);
  });
  const xrefOffset = position;
  const size = offsets.length;
  const xref = [text(`xref\n0 ${size}\n0000000000 65535 f \n`)];
  for (let id = 1; id < size; id += 1) xref.push(text(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`));
  xref.push(text(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`));
  return joinBytes([...parts, ...xref]);
}
