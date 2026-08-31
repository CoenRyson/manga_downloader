const paddleModels = {
  det: {
    filename: "PP-OCRv6_small_det_onnx_infer.tar",
    maxBytes: 12 * 1024 * 1024,
  },
  rec: {
    filename: "PP-OCRv6_small_rec_onnx_infer.tar",
    maxBytes: 25 * 1024 * 1024,
  },
} as const;

const paddleModelBase = "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/";

export async function GET(request: Request) {
  const modelKey = new URL(request.url).searchParams.get("model") as keyof typeof paddleModels | null;
  const model = modelKey ? paddleModels[modelKey] : undefined;
  if (!model) return Response.json({ error: "Neznámý OCR model." }, { status: 404 });

  try {
    const response = await fetch(`${paddleModelBase}${model.filename}`, {
      headers: {
        Accept: "application/octet-stream",
        "User-Agent": "Manga Reader local PaddleOCR loader",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok || !response.body) throw new Error(`PaddleOCR model ${response.status}`);
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (!declaredLength || declaredLength > model.maxBytes) throw new Error("Neočekávaná velikost OCR modelu.");

    return new Response(response.body, {
      headers: {
        "Content-Type": "application/x-tar",
        "Content-Length": String(declaredLength),
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "OCR model se nepodařilo stáhnout." }, { status: 502 });
  }
}
